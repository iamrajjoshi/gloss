import { describe, expect, it } from 'vitest';
import { loadViewedFiles, saveViewedFiles, viewedFilesStorageKey } from './viewed-files';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
}

describe('viewed file persistence', () => {
  it('saves viewed files by review id', () => {
    const storage = memoryStorage();

    saveViewedFiles('review-1', new Set(['src/b.ts', 'src/a.ts']), storage);

    expect(storage.getItem(viewedFilesStorageKey('review-1'))).toBe(
      JSON.stringify(['src/a.ts', 'src/b.ts'])
    );
    expect(loadViewedFiles('review-1', storage)).toEqual(new Set(['src/a.ts', 'src/b.ts']));
    expect(loadViewedFiles('review-2', storage)).toEqual(new Set());
  });

  it('removes storage when every file is unviewed', () => {
    const storage = memoryStorage();
    saveViewedFiles('review-1', new Set(['src/a.ts']), storage);

    saveViewedFiles('review-1', new Set(), storage);

    expect(storage.getItem(viewedFilesStorageKey('review-1'))).toBeNull();
    expect(loadViewedFiles('review-1', storage)).toEqual(new Set());
  });

  it('ignores malformed storage values', () => {
    const storage = memoryStorage();
    storage.setItem(viewedFilesStorageKey('review-1'), '{not-json');

    expect(loadViewedFiles('review-1', storage)).toEqual(new Set());
  });
});
