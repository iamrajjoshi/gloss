import { describe, expect, it } from 'vitest';
import type { DiffHunk, DiffLine } from '../../shared/types';
import { fileCardElementId, hunkHeaderForVisibleLines } from './diff-view-helpers';

const hunk: DiffHunk = {
  oldStart: 300,
  oldLines: 8,
  newStart: 318,
  newLines: 8,
  header: 'def handle_exception_retry(',
  lines: []
};

describe('fileCardElementId', () => {
  it('generates distinct ids for paths that differ by encoded separators', () => {
    expect(fileCardElementId('src/web/App.tsx')).not.toBe(fileCardElementId('src_2Fweb/App.tsx'));
  });
});

describe('hunkHeaderForVisibleLines', () => {
  it('hides a function signature once its original context line is visible', () => {
    const visibleLines: DiffLine[] = [
      {
        type: 'context',
        oldLine: 297,
        newLine: 315,
        content: '    def handle_exception_retry('
      }
    ];

    expect(hunkHeaderForVisibleLines(hunk, visibleLines)).toBeNull();
  });

  it('keeps a function signature while its original line is hidden', () => {
    const visibleLines: DiffLine[] = [
      {
        type: 'context',
        oldLine: 298,
        newLine: 316,
        content: '    def handle_exception_retry_other('
      }
    ];

    expect(hunkHeaderForVisibleLines(hunk, visibleLines)).toBe(hunk.header);
  });

  it('keeps a function signature when matching context is inside the hunk', () => {
    const visibleLines: DiffLine[] = [
      {
        type: 'context',
        oldLine: hunk.oldStart,
        newLine: hunk.newStart,
        content: '    def handle_exception_retry('
      }
    ];

    expect(hunkHeaderForVisibleLines(hunk, visibleLines)).toBe(hunk.header);
  });

  it('keeps coordinate headers when git provides no function signature', () => {
    expect(hunkHeaderForVisibleLines({ ...hunk, header: '' }, [])).toBe('@@ -300,8 +318,8 @@');
  });
});
