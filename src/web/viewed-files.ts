import type { JsonValue } from '../shared/json';

interface ViewedFileStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const viewedFilesStoragePrefix = 'gloss:viewed-files:';

export function viewedFilesStorageKey(reviewId: string): string {
  return `${viewedFilesStoragePrefix}${reviewId}`;
}

export function loadViewedFiles(
  reviewId: string,
  storage: ViewedFileStorage | null = browserStorage()
): Set<string> {
  if (!storage) {
    return new Set();
  }

  const raw = storage.getItem(viewedFilesStorageKey(reviewId));
  if (!raw) {
    return new Set();
  }

  try {
    const parsed: JsonValue = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((filePath) => typeof filePath === 'string') : []
    );
  } catch {
    return new Set();
  }
}

export function saveViewedFiles(
  reviewId: string,
  viewedFiles: Set<string>,
  storage: ViewedFileStorage | null = browserStorage()
): void {
  if (!storage) {
    return;
  }

  const key = viewedFilesStorageKey(reviewId);
  if (viewedFiles.size === 0) {
    storage.removeItem(key);
    return;
  }

  storage.setItem(key, JSON.stringify([...viewedFiles].sort()));
}

function browserStorage(): ViewedFileStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
