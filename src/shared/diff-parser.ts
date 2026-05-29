import { languageForPath } from './language';
import type { DiffFile, DiffHunk, DiffLine } from './types';

const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function stripGitPath(input: string): string {
  return input.replace(/^[ab]\//, '');
}

function emptyFile(): DiffFile {
  return {
    path: '',
    oldPath: null,
    additions: 0,
    deletions: 0,
    isBinary: false,
    isDeleted: false,
    isNew: false,
    isRenamed: false,
    language: null,
    hunks: []
  };
}

export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldCursor = 0;
  let newCursor = 0;

  const finalizeFile = () => {
    if (current?.path) {
      current.language = languageForPath(current.path);
      files.push(current);
    }
  };

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      finalizeFile();
      current = emptyFile();
      currentHunk = null;
      oldCursor = 0;
      newCursor = 0;
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (match) {
        current.oldPath = match[1];
        current.path = match[2];
      }
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith('new file mode')) {
      current.isNew = true;
      continue;
    }

    if (line.startsWith('deleted file mode')) {
      current.isDeleted = true;
      continue;
    }

    if (line.startsWith('rename from ')) {
      current.oldPath = line.slice('rename from '.length);
      current.isRenamed = true;
      continue;
    }

    if (line.startsWith('rename to ')) {
      current.path = line.slice('rename to '.length);
      current.isRenamed = true;
      continue;
    }

    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.isBinary = true;
      continue;
    }

    if (line.startsWith('--- ')) {
      const oldPath = line.slice(4).trim();
      current.oldPath = oldPath === '/dev/null' ? null : stripGitPath(oldPath);
      continue;
    }

    if (line.startsWith('+++ ')) {
      const newPath = line.slice(4).trim();
      current.path =
        newPath === '/dev/null' ? (current.oldPath ?? current.path) : stripGitPath(newPath);
      continue;
    }

    const hunkMatch = hunkHeaderPattern.exec(line);
    if (hunkMatch) {
      const oldStart = Number(hunkMatch[1]);
      const oldLines = Number(hunkMatch[2] ?? '1');
      const newStart = Number(hunkMatch[3]);
      const newLines = Number(hunkMatch[4] ?? '1');
      currentHunk = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        header: hunkMatch[5]?.trim() ?? '',
        lines: []
      };
      current.hunks.push(currentHunk);
      oldCursor = oldStart;
      newCursor = newStart;
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    const marker = line[0];
    const content = line.slice(1);
    let diffLine: DiffLine | null = null;

    if (marker === '+') {
      diffLine = { type: 'add', oldLine: null, newLine: newCursor, content };
      current.additions += 1;
      newCursor += 1;
    } else if (marker === '-') {
      diffLine = { type: 'delete', oldLine: oldCursor, newLine: null, content };
      current.deletions += 1;
      oldCursor += 1;
    } else if (marker === ' ') {
      diffLine = { type: 'context', oldLine: oldCursor, newLine: newCursor, content };
      oldCursor += 1;
      newCursor += 1;
    } else if (line.startsWith('\\ No newline at end of file')) {
      continue;
    }

    if (diffLine) {
      currentHunk.lines.push(diffLine);
    }
  }

  finalizeFile();
  return files;
}
