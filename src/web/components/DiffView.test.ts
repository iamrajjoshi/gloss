import { describe, expect, it } from 'vitest';
import type { DiffHunk, DiffLine } from '../../shared/types';
import {
  buildDiffVisualIndex,
  clampSplitPanePercentage,
  DEFAULT_SPLIT_PANE_PERCENTAGE,
  diffLineNumberForSide,
  diffSnippetForRange,
  fileCardElementId,
  hasResizableSplitContent,
  hunkHeaderForVisibleLines,
  MAX_SPLIT_PANE_PERCENTAGE,
  MIN_SPLIT_PANE_PERCENTAGE,
  splitDiffLines,
  splitPanePercentageForKey,
  splitPanePercentageForPointer
} from './diff-view-helpers';

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

describe('splitDiffLines', () => {
  it('duplicates context on both sides with independent line numbers', () => {
    const context = line('context', 8, 11, 'shared');

    expect(splitDiffLines([context])).toEqual([{ left: context, right: context }]);
    expect(diffLineNumberForSide(context, 'L')).toBe(8);
    expect(diffLineNumberForSide(context, 'R')).toBe(11);
  });

  it('pairs replacement lines and pads the shorter side', () => {
    const deletedFirst = line('delete', 8, null, 'old first');
    const deletedSecond = line('delete', 9, null, 'old second');
    const added = line('add', null, 8, 'new first');

    expect(splitDiffLines([deletedFirst, deletedSecond, added])).toEqual([
      { left: deletedFirst, right: added },
      { left: deletedSecond, right: null }
    ]);
  });

  it('pads insertion-only and deletion-only blocks', () => {
    const deleted = line('delete', 2, null, 'gone');
    const added = line('add', null, 4, 'new');

    expect(splitDiffLines([deleted])).toEqual([{ left: deleted, right: null }]);
    expect(splitDiffLines([added])).toEqual([{ left: null, right: added }]);
  });

  it('does not pair changes across context boundaries', () => {
    const deleted = line('delete', 2, null, 'gone');
    const context = line('context', 3, 3, 'shared');
    const added = line('add', null, 4, 'new');

    expect(splitDiffLines([deleted, context, added])).toEqual([
      { left: deleted, right: null },
      { left: context, right: context },
      { left: null, right: added }
    ]);
  });

  it('keeps an empty changed line distinct from alignment padding', () => {
    const deleted = line('delete', 7, null, 'old');
    const added = line('add', null, 7, '');

    expect(splitDiffLines([deleted, added])).toEqual([{ left: deleted, right: added }]);
  });
});

describe('split pane sizing', () => {
  it('only enables resizing for nonbinary files with diff hunks', () => {
    expect(hasResizableSplitContent(false, 1)).toBe(true);
    expect(hasResizableSplitContent(false, 0)).toBe(false);
    expect(hasResizableSplitContent(true, 1)).toBe(false);
  });

  it('defaults to an even split', () => {
    expect(DEFAULT_SPLIT_PANE_PERCENTAGE).toBe(50);
  });

  it('calculates pointer positions relative to the diff table', () => {
    expect(splitPanePercentageForPointer(600, 100, 1000)).toBe(50);
    expect(splitPanePercentageForPointer(700, 100, 1000)).toBe(60);
  });

  it('clamps pointer positions to keep both panes usable', () => {
    expect(splitPanePercentageForPointer(-100, 100, 1000)).toBe(MIN_SPLIT_PANE_PERCENTAGE);
    expect(splitPanePercentageForPointer(1400, 100, 1000)).toBe(MAX_SPLIT_PANE_PERCENTAGE);
  });

  it('uses a safe fallback for invalid dimensions', () => {
    expect(splitPanePercentageForPointer(500, 100, 0, 60)).toBe(60);
    expect(clampSplitPanePercentage(Number.NaN)).toBe(DEFAULT_SPLIT_PANE_PERCENTAGE);
  });

  it('supports keyboard resizing and clamps at the bounds', () => {
    expect(splitPanePercentageForKey(50, 'ArrowLeft')).toBe(45);
    expect(splitPanePercentageForKey(50, 'ArrowRight')).toBe(55);
    expect(splitPanePercentageForKey(MIN_SPLIT_PANE_PERCENTAGE, 'ArrowLeft')).toBe(
      MIN_SPLIT_PANE_PERCENTAGE
    );
    expect(splitPanePercentageForKey(MAX_SPLIT_PANE_PERCENTAGE, 'ArrowRight')).toBe(
      MAX_SPLIT_PANE_PERCENTAGE
    );
    expect(splitPanePercentageForKey(50, 'Home')).toBe(MIN_SPLIT_PANE_PERCENTAGE);
    expect(splitPanePercentageForKey(50, 'End')).toBe(MAX_SPLIT_PANE_PERCENTAGE);
    expect(splitPanePercentageForKey(50, 'Enter')).toBeNull();
  });
});

describe('diffSnippetForRange', () => {
  it('collects only lines visible on the selected side', () => {
    const lines = [
      line('context', 1, 1, 'before'),
      line('delete', 2, null, 'old'),
      line('add', null, 2, 'new'),
      line('context', 3, 3, 'after')
    ];

    expect(diffSnippetForRange(lines, 'L', 1, 3, 'split')).toBe(' before\n-old\n after');
    expect(diffSnippetForRange(lines, 'R', 1, 3, 'split')).toBe(' before\n+new\n after');
  });

  it('keeps opposite-side replacement lines in unified ranges', () => {
    const lines = [
      line('context', 1, 1, 'before'),
      line('delete', 2, null, 'old'),
      line('add', null, 2, 'new'),
      line('context', 3, 3, 'after')
    ];

    expect(diffSnippetForRange(lines, 'R', 1, 3, 'unified')).toBe(' before\n-old\n+new\n after');
    expect(diffSnippetForRange(lines, 'L', 1, 3, 'unified')).toBe(' before\n-old\n+new\n after');
  });

  it('returns an empty snippet when either endpoint is not visible on the side', () => {
    expect(diffSnippetForRange([line('add', null, 1, 'new')], 'L', 1, 1, 'split')).toBe('');
  });
});

describe('buildDiffVisualIndex', () => {
  const lines = [
    line('context', 1, 1, 'before'),
    line('delete', 2, null, 'old'),
    line('add', null, 2, 'new'),
    line('context', 3, 3, 'after')
  ];

  it('uses one shared row index in unified mode', () => {
    const indexes = buildDiffVisualIndex(lines, 'unified');

    expect(indexes.get('L:1')).toBe(0);
    expect(indexes.get('R:1')).toBe(0);
    expect(indexes.get('L:2')).toBe(1);
    expect(indexes.get('R:2')).toBe(2);
    expect(indexes.get('L:3')).toBe(3);
    expect(indexes.get('R:3')).toBe(3);
  });

  it('indexes each pane independently in split mode', () => {
    const indexes = buildDiffVisualIndex(lines, 'split');

    expect(indexes.get('L:1')).toBe(0);
    expect(indexes.get('R:1')).toBe(0);
    expect(indexes.get('L:2')).toBe(1);
    expect(indexes.get('R:2')).toBe(1);
    expect(indexes.get('L:3')).toBe(2);
    expect(indexes.get('R:3')).toBe(2);
  });
});

function line(
  type: DiffLine['type'],
  oldLine: number | null,
  newLine: number | null,
  content: string
): DiffLine {
  return { type, oldLine, newLine, content };
}
