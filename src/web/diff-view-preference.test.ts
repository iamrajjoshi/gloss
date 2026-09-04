import { describe, expect, it } from 'vitest';
import { diffViewModeStorageKey, loadDiffViewMode, saveDiffViewMode } from './diff-view-preference';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
}

describe('diff view preference persistence', () => {
  it('defaults to unified when storage is empty or unavailable', () => {
    expect(loadDiffViewMode(null)).toBe('unified');
    expect(loadDiffViewMode(memoryStorage())).toBe('unified');
  });

  it('saves and loads explicit view modes', () => {
    const storage = memoryStorage();

    saveDiffViewMode('split', storage);
    expect(storage.getItem(diffViewModeStorageKey)).toBe('split');
    expect(loadDiffViewMode(storage)).toBe('split');

    saveDiffViewMode('unified', storage);
    expect(loadDiffViewMode(storage)).toBe('unified');
  });

  it('falls back to unified for unsupported storage values', () => {
    const storage = memoryStorage();
    storage.setItem(diffViewModeStorageKey, 'side-by-side');

    expect(loadDiffViewMode(storage)).toBe('unified');
  });

  it('ignores storage failures', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    };

    expect(loadDiffViewMode(storage)).toBe('unified');
    expect(() => saveDiffViewMode('split', storage)).not.toThrow();
  });
});
