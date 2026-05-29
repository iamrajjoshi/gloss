import type { DiffFile, DiffStats } from './types';

export function summarizeDiffFiles(files: DiffFile[]): DiffStats {
  return files.reduce(
    (stats, file) => ({
      files: stats.files + 1,
      additions: stats.additions + file.additions,
      deletions: stats.deletions + file.deletions
    }),
    { files: 0, additions: 0, deletions: 0 }
  );
}
