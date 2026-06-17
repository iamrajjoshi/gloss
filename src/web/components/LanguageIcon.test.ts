import { describe, expect, it } from 'vitest';
import { languageIconForLanguage } from './LanguageIcon';

describe('languageIconForLanguage', () => {
  it('uses the React logo for TSX and JSX files', () => {
    expect(languageIconForLanguage('tsx')?.icon.title).toBe('React');
    expect(languageIconForLanguage('jsx')?.icon.title).toBe('React');
  });

  it('uses the TypeScript logo for TypeScript files', () => {
    expect(languageIconForLanguage('ts')?.icon.title).toBe('TypeScript');
  });

  it('falls back for unknown, missing, and binary languages', () => {
    expect(languageIconForLanguage('txt')).toBeNull();
    expect(languageIconForLanguage(null)).toBeNull();
    expect(languageIconForLanguage('ts', true)).toBeNull();
  });
});
