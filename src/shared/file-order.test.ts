import { describe, expect, it } from 'vitest';
import { sortDiffFiles } from './file-order';
import type { DiffFile } from './types';

describe('sortDiffFiles', () => {
  it('sorts files by full destination path with exact path and old path tie-breakers', () => {
    const files = [
      makeFile('src/web/store.ts'),
      makeFile('README.md'),
      makeFile('src/Web/App.tsx'),
      makeFile('src/web/App.tsx', 'src/old-app.tsx'),
      makeFile('src/web/App.tsx', 'src/older-app.tsx'),
      makeFile('a/root.ts')
    ];

    expect(sortDiffFiles(files).map((file) => `${file.path}:${file.oldPath ?? ''}`)).toEqual([
      'a/root.ts:',
      'README.md:',
      'src/web/App.tsx:src/old-app.tsx',
      'src/web/App.tsx:src/older-app.tsx',
      'src/Web/App.tsx:',
      'src/web/store.ts:'
    ]);
  });
});

function makeFile(path: string, oldPath: string | null = null): DiffFile {
  return {
    path,
    oldPath,
    additions: 1,
    deletions: 0,
    isBinary: false,
    isDeleted: false,
    isNew: false,
    isRenamed: oldPath !== null,
    language: null,
    hunks: []
  };
}
