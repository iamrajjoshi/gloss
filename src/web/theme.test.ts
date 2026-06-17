import { describe, expect, it } from 'vitest';
import {
  applyDocumentTheme,
  loadThemePreference,
  resolvedThemeForSystemPreference,
  resolveThemePreference,
  saveThemePreference,
  themePreferenceStorageKey
} from './theme';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
}

describe('theme preference persistence', () => {
  it('defaults to system when storage is empty or unavailable', () => {
    expect(loadThemePreference(null)).toBe('system');
    expect(loadThemePreference(memoryStorage())).toBe('system');
  });

  it('saves and loads explicit preferences', () => {
    const storage = memoryStorage();

    saveThemePreference('light', storage);
    expect(storage.getItem(themePreferenceStorageKey)).toBe('light');
    expect(loadThemePreference(storage)).toBe('light');

    saveThemePreference('dark', storage);
    expect(loadThemePreference(storage)).toBe('dark');

    saveThemePreference('system', storage);
    expect(loadThemePreference(storage)).toBe('system');
  });

  it('falls back to system for malformed storage values', () => {
    const storage = memoryStorage();
    storage.setItem(themePreferenceStorageKey, 'sepia');

    expect(loadThemePreference(storage)).toBe('system');
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

    expect(loadThemePreference(storage)).toBe('system');
    expect(() => saveThemePreference('dark', storage)).not.toThrow();
  });
});

describe('theme resolution', () => {
  it('resolves system from the current media query state', () => {
    expect(resolvedThemeForSystemPreference(true)).toBe('dark');
    expect(resolvedThemeForSystemPreference(false)).toBe('light');
    expect(resolveThemePreference('system', 'dark')).toBe('dark');
    expect(resolveThemePreference('system', 'light')).toBe('light');
  });

  it('prefers explicit light or dark over system', () => {
    expect(resolveThemePreference('light', 'dark')).toBe('light');
    expect(resolveThemePreference('dark', 'light')).toBe('dark');
  });

  it('applies the resolved theme to the document root', () => {
    const root = { dataset: {} } as HTMLElement;

    applyDocumentTheme('light', root);
    expect(root.dataset.theme).toBe('light');

    applyDocumentTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
  });
});
