import type { DiffHunk, DiffLine } from '../../shared/types';

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
