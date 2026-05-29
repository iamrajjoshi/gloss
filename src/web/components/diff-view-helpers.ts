export function fileCardElementId(filePath: string): string {
  return `gloss-file-${encodeURIComponent(filePath)}`;
}
