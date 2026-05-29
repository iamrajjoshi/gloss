export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
