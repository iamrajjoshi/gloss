import type { DiffFile } from './types';

const BORING_FILE_PRESETS = ['lockfiles', 'snapshots', 'generated', 'vendored'] as const;

export type BoringFilePreset = (typeof BORING_FILE_PRESETS)[number];

export interface BoringFilePresetInfo {
  id: BoringFilePreset;
  label: string;
}

export const BORING_FILE_PRESET_INFO: BoringFilePresetInfo[] = [
  { id: 'lockfiles', label: 'Lockfiles' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'generated', label: 'Generated' },
  { id: 'vendored', label: 'Vendored' }
];

const LOCKFILE_BASENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'Pipfile.lock',
  'poetry.lock',
  'uv.lock',
  'go.sum',
  'composer.lock',
  'mix.lock',
  'flake.lock',
  'deno.lock',
  'Podfile.lock'
]);

const GENERATED_MARKERS = [
  '@generated',
  'Code generated',
  'DO NOT EDIT',
  'automatically generated'
];

export function boringFilePresetsFor(file: DiffFile): Set<BoringFilePreset> {
  const presets = new Set<BoringFilePreset>();
  const paths = [file.path, file.oldPath].filter((value): value is string => Boolean(value));

  if (paths.some(isLockfilePath)) {
    presets.add('lockfiles');
  }
  if (paths.some(isSnapshotPath)) {
    presets.add('snapshots');
  }
  if (paths.some(isGeneratedPath) || hasGeneratedMarker(file)) {
    presets.add('generated');
  }
  if (paths.some(isVendoredPath)) {
    presets.add('vendored');
  }

  return presets;
}

function isBoringFile(file: DiffFile, hiddenPresets: Set<BoringFilePreset>): boolean {
  if (hiddenPresets.size === 0) {
    return false;
  }
  const filePresets = boringFilePresetsFor(file);
  for (const preset of hiddenPresets) {
    if (filePresets.has(preset)) {
      return true;
    }
  }
  return false;
}

export function filterBoringFiles(
  files: DiffFile[],
  hiddenPresets: Set<BoringFilePreset>
): { files: DiffFile[]; hidden: DiffFile[] } {
  if (hiddenPresets.size === 0) {
    return { files, hidden: [] };
  }

  const visible: DiffFile[] = [];
  const hidden: DiffFile[] = [];
  for (const file of files) {
    (isBoringFile(file, hiddenPresets) ? hidden : visible).push(file);
  }
  return { files: visible, hidden };
}

export function parseBoringFilePresets(value: unknown): Set<BoringFilePreset> {
  if (!Array.isArray(value)) {
    return new Set();
  }
  const valid = new Set<string>(BORING_FILE_PRESETS);
  return new Set(value.filter((entry): entry is BoringFilePreset => valid.has(String(entry))));
}

function isLockfilePath(filePath: string): boolean {
  const basename = basenameFor(filePath);
  return LOCKFILE_BASENAMES.has(basename) || /^bun\.lock/.test(basename);
}

function isSnapshotPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const basename = basenameFor(normalized);
  return (
    normalized.split('/').includes('__snapshots__') ||
    /\.snap(?:\.|$)/.test(basename) ||
    /\.snapshot(?:\.|$)/.test(basename)
  );
}

function isGeneratedPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const basename = basenameFor(normalized);
  const segments = normalized.split('/');
  return (
    segments.includes('__generated__') ||
    segments.includes('generated') ||
    /\.generated\./.test(basename) ||
    /\.gen\./.test(basename) ||
    /\.pb\./.test(basename)
  );
}

function isVendoredPath(filePath: string): boolean {
  const segments = normalizePath(filePath).split('/');
  return (
    segments.includes('vendor') ||
    segments.includes('vendors') ||
    segments.includes('third_party') ||
    segments.includes('third-party') ||
    segments.includes('external') ||
    segments.includes('node_modules') ||
    segments.includes('bower_components') ||
    segments.includes('Pods') ||
    segments.includes('Carthage') ||
    hasAdjacentPathSegments(segments, ['.yarn', 'cache'])
  );
}

function hasGeneratedMarker(file: DiffFile): boolean {
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (isGeneratedMarkerLine(line.content)) {
        return true;
      }
    }
  }
  return false;
}

function isGeneratedMarkerLine(content: string): boolean {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();
  if (!/^(\/\/|#|\/\*|\*|<!--|;|--)/.test(trimmed)) {
    return false;
  }
  return GENERATED_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
}

function hasAdjacentPathSegments(segments: string[], adjacentSegments: string[]): boolean {
  return segments.some((_, startIndex) =>
    adjacentSegments.every((part, offset) => segments[startIndex + offset] === part)
  );
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function basenameFor(filePath: string): string {
  return normalizePath(filePath).split('/').pop() ?? filePath;
}
