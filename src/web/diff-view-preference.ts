import type { DiffViewMode } from './components/diff-view-helpers';

interface DiffViewPreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const diffViewModeStorageKey = 'gloss:diff-view-mode';

export function loadDiffViewMode(
  storage: DiffViewPreferenceStorage | null = browserStorage()
): DiffViewMode {
  if (!storage) {
    return 'unified';
  }

  try {
    const storedMode = storage.getItem(diffViewModeStorageKey);
    return isDiffViewMode(storedMode) ? storedMode : 'unified';
  } catch {
    return 'unified';
  }
}

export function saveDiffViewMode(
  mode: DiffViewMode,
  storage: DiffViewPreferenceStorage | null = browserStorage()
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(diffViewModeStorageKey, mode);
  } catch {
    // Browser storage can be disabled; the view toggle should still work for the session.
  }
}

function isDiffViewMode(value: string | null): value is DiffViewMode {
  return value === 'unified' || value === 'split';
}

function browserStorage(): DiffViewPreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
