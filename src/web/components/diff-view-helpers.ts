import { diffLineKey } from '../../shared/diff-lines';
import type { DiffHunk, DiffLine, Side } from '../../shared/types';

export type DiffViewMode = 'unified' | 'split';

export interface SplitDiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

export const DEFAULT_SPLIT_PANE_PERCENTAGE = 50;
export const MIN_SPLIT_PANE_PERCENTAGE = 25;
export const MAX_SPLIT_PANE_PERCENTAGE = 75;
export const SPLIT_PANE_KEYBOARD_STEP = 5;

export function clampSplitPanePercentage(percentage: number): number {
  if (!Number.isFinite(percentage)) {
    return DEFAULT_SPLIT_PANE_PERCENTAGE;
  }
  return Math.min(MAX_SPLIT_PANE_PERCENTAGE, Math.max(MIN_SPLIT_PANE_PERCENTAGE, percentage));
}

export function splitPanePercentageForPointer(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
  fallback = DEFAULT_SPLIT_PANE_PERCENTAGE
): number {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(containerLeft) ||
    !Number.isFinite(containerWidth) ||
    containerWidth <= 0
  ) {
    return clampSplitPanePercentage(fallback);
  }
  return clampSplitPanePercentage(((clientX - containerLeft) / containerWidth) * 100);
}

export function splitPanePercentageForKey(percentage: number, key: string): number | null {
  if (key === 'ArrowLeft') {
    return clampSplitPanePercentage(percentage - SPLIT_PANE_KEYBOARD_STEP);
  }
  if (key === 'ArrowRight') {
    return clampSplitPanePercentage(percentage + SPLIT_PANE_KEYBOARD_STEP);
  }
  if (key === 'Home') {
    return MIN_SPLIT_PANE_PERCENTAGE;
  }
  if (key === 'End') {
    return MAX_SPLIT_PANE_PERCENTAGE;
  }
  return null;
}

export function hasResizableSplitContent(isBinary: boolean, hunkCount: number): boolean {
  return !isBinary && hunkCount > 0;
}

export function fileCardElementId(filePath: string): string {
  return `gloss-file-${encodeURIComponent(filePath)}`;
}

export function hunkHeaderForVisibleLines(hunk: DiffHunk, lines: DiffLine[]): string | null {
  const header = hunk.header.trim();
  const headerLineIsVisible =
    header.length > 0 &&
    lines.some(
      (line) =>
        line.type === 'context' &&
        line.oldLine != null &&
        line.oldLine < hunk.oldStart &&
        line.content.trim() === header
    );

  if (headerLineIsVisible) {
    return null;
  }

  return header || `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

export function diffLineNumberForSide(line: DiffLine, side: Side): number | null {
  return side === 'L' ? line.oldLine : line.newLine;
}

export function diffLineMarker(line: DiffLine): string {
  if (line.type === 'add') {
    return '+';
  }
  if (line.type === 'delete') {
    return '-';
  }
  return ' ';
}

export function diffSnippetForRange(
  lines: DiffLine[],
  side: Side,
  startLine: number,
  endLine: number,
  viewMode: DiffViewMode
): string {
  const selectableLines =
    viewMode === 'split'
      ? lines.filter((line) => diffLineNumberForSide(line, side) != null)
      : lines;
  const startIndex = selectableLines.findIndex(
    (line) => diffLineNumberForSide(line, side) === startLine
  );
  const endIndex = selectableLines.findIndex(
    (line) => diffLineNumberForSide(line, side) === endLine
  );
  if (startIndex < 0 || endIndex < 0) {
    return '';
  }

  const selectedLines = selectableLines.slice(
    Math.min(startIndex, endIndex),
    Math.max(startIndex, endIndex) + 1
  );
  const hasMixedLineTypes = new Set(selectedLines.map((line) => line.type)).size > 1;
  return selectedLines
    .map((line) => (hasMixedLineTypes ? `${diffLineMarker(line)}${line.content}` : line.content))
    .join('\n');
}

export function buildDiffVisualIndex(
  lines: DiffLine[],
  viewMode: DiffViewMode
): Map<string, number> {
  const indexByLine = new Map<string, number>();
  if (viewMode === 'unified') {
    lines.forEach((line, index) => {
      if (line.oldLine != null) {
        indexByLine.set(diffLineKey('L', line.oldLine), index);
      }
      if (line.newLine != null) {
        indexByLine.set(diffLineKey('R', line.newLine), index);
      }
    });
    return indexByLine;
  }

  let leftIndex = 0;
  let rightIndex = 0;
  for (const line of lines) {
    if (line.oldLine != null) {
      indexByLine.set(diffLineKey('L', line.oldLine), leftIndex);
      leftIndex += 1;
    }
    if (line.newLine != null) {
      indexByLine.set(diffLineKey('R', line.newLine), rightIndex);
      rightIndex += 1;
    }
  }
  return indexByLine;
}

export function splitDiffLines(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let deletions: DiffLine[] = [];
  let additions: DiffLine[] = [];

  const flushChanges = () => {
    const rowCount = Math.max(deletions.length, additions.length);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        left: deletions[index] ?? null,
        right: additions[index] ?? null
      });
    }
    deletions = [];
    additions = [];
  };

  for (const line of lines) {
    if (line.type === 'context') {
      flushChanges();
      rows.push({ left: line, right: line });
    } else if (line.type === 'delete') {
      deletions.push(line);
    } else {
      additions.push(line);
    }
  }

  flushChanges();
  return rows;
}
