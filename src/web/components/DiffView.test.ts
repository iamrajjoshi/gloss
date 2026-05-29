import { describe, expect, it } from 'vitest';
import { fileCardElementId } from './DiffView';

describe('fileCardElementId', () => {
  it('generates distinct ids for paths that differ by encoded separators', () => {
    expect(fileCardElementId('src/web/App.tsx')).not.toBe(fileCardElementId('src_2Fweb/App.tsx'));
  });
});
