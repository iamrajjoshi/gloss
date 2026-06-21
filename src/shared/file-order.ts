import type { DiffFile } from './types';

export function compareFilePaths(
  leftPath: string,
  rightPath: string,
  leftTieBreaker = '',
  rightTieBreaker = ''
): number {
  return (
    leftPath.localeCompare(rightPath, undefined, { sensitivity: 'base' }) ||
    leftPath.localeCompare(rightPath) ||
    leftTieBreaker.localeCompare(rightTieBreaker, undefined, { sensitivity: 'base' }) ||
    leftTieBreaker.localeCompare(rightTieBreaker)
  );
}

function compareDiffFiles(left: DiffFile, right: DiffFile): number {
  return compareFilePaths(left.path, right.path, left.oldPath ?? '', right.oldPath ?? '');
}

export function sortDiffFiles<T extends DiffFile>(files: T[]): T[] {
  return files.toSorted(compareDiffFiles);
}
