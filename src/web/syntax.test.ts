import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../shared/types';
import { highlightDiffFile, rowKey, shikiLanguageForGlossLanguage } from './syntax';

describe('shikiLanguageForGlossLanguage', () => {
  it('maps supported Gloss languages to Shiki languages', () => {
    expect(shikiLanguageForGlossLanguage('js')).toBe('javascript');
    expect(shikiLanguageForGlossLanguage('ts')).toBe('typescript');
    expect(shikiLanguageForGlossLanguage('jsx')).toBe('jsx');
    expect(shikiLanguageForGlossLanguage('tsx')).toBe('tsx');
    expect(shikiLanguageForGlossLanguage('css')).toBe('css');
    expect(shikiLanguageForGlossLanguage('html')).toBe('html');
    expect(shikiLanguageForGlossLanguage('json')).toBe('json');
    expect(shikiLanguageForGlossLanguage('markdown')).toBe('markdown');
    expect(shikiLanguageForGlossLanguage('yaml')).toBe('yaml');
    expect(shikiLanguageForGlossLanguage('bash')).toBe('bash');
    expect(shikiLanguageForGlossLanguage('python')).toBe('python');
    expect(shikiLanguageForGlossLanguage('ruby')).toBe('ruby');
    expect(shikiLanguageForGlossLanguage('rust')).toBe('rust');
    expect(shikiLanguageForGlossLanguage('go')).toBe('go');
    expect(shikiLanguageForGlossLanguage('swift')).toBe('swift');
  });

  it('returns null for unsupported or missing languages', () => {
    expect(shikiLanguageForGlossLanguage(null)).toBeNull();
    expect(shikiLanguageForGlossLanguage('txt')).toBeNull();
  });
});

describe('highlightDiffFile', () => {
  it('highlights TypeScript rows while preserving row text exactly', async () => {
    const file: DiffFile = {
      path: 'app.ts',
      oldPath: null,
      additions: 1,
      deletions: 1,
      isBinary: false,
      isDeleted: false,
      isNew: false,
      isRenamed: false,
      language: 'ts',
      hunks: [
        {
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 2,
          header: '',
          lines: [
            { type: 'context', oldLine: 1, newLine: 1, content: "import x from 'x';" },
            { type: 'delete', oldLine: 2, newLine: null, content: 'const oldName = 1;' },
            { type: 'add', oldLine: null, newLine: 2, content: 'const newName = 1;' }
          ]
        }
      ]
    };

    const highlighted = await highlightDiffFile(file);

    expect(highlighted).not.toBeNull();
    expect(
      highlighted
        ?.get(rowKey('R', 1))
        ?.map((token) => token.content)
        .join('')
    ).toBe("import x from 'x';");
    expect(
      highlighted
        ?.get(rowKey('L', 2))
        ?.map((token) => token.content)
        .join('')
    ).toBe('const oldName = 1;');
    expect(
      highlighted
        ?.get(rowKey('R', 2))
        ?.map((token) => token.content)
        .join('')
    ).toBe('const newName = 1;');
    expect(highlighted?.get(rowKey('R', 2))?.some((token) => token.color)).toBe(true);
  });

  it('falls back for unsupported languages and binary files', async () => {
    const file: DiffFile = {
      path: 'notes.txt',
      oldPath: null,
      additions: 1,
      deletions: 0,
      isBinary: false,
      isDeleted: false,
      isNew: false,
      isRenamed: false,
      language: 'txt',
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          header: '',
          lines: [{ type: 'add', oldLine: null, newLine: 1, content: 'hello' }]
        }
      ]
    };

    expect(await highlightDiffFile(file)).toBeNull();
    expect(await highlightDiffFile({ ...file, language: 'ts', isBinary: true })).toBeNull();
  });
});
