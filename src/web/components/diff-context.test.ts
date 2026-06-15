import { describe, expect, it } from 'vitest';
import { DIFF_CONTEXT_MAX_LINES, type DiffFile, type DiffLine } from '../../shared/types';
import {
  buildContextGaps,
  contextExpansionDirectionForSegment,
  contextExpansionRequest,
  contextLinesForGap,
  expandedContextSegments,
  mergeContextLines,
  visibleDiffLines
} from './diff-context';

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
      oldStart: 3,
      oldLines: 2,
      newStart: 3,
      newLines: 2,
      header: '',
      lines: [
        { type: 'context', oldLine: 3, newLine: 3, content: 'line 3' },
        { type: 'add', oldLine: null, newLine: 4, content: 'line 4 new' }
      ]
    },
    {
      oldStart: 15,
      oldLines: 2,
      newStart: 15,
      newLines: 2,
      header: '',
      lines: [
        { type: 'delete', oldLine: 15, newLine: null, content: 'line 15 old' },
        { type: 'context', oldLine: 16, newLine: 16, content: 'line 16' }
      ]
    }
  ]
};

function contextLines(oldStart: number, lineCount: number): DiffLine[] {
  return Array.from({ length: lineCount }, (_, index) => ({
    type: 'context' as const,
    oldLine: oldStart + index,
    newLine: oldStart + index,
    content: `line ${oldStart + index}`
  }));
}

describe('diff context helpers', () => {
  it('finds hidden context gaps before hunks', () => {
    expect(buildContextGaps(file)).toMatchObject([
      { oldStart: 1, newStart: 1, lineCount: 2, beforeHunkIndex: 0 },
      { oldStart: 5, newStart: 5, lineCount: 10, beforeHunkIndex: 1 }
    ]);
  });

  it('chooses the reveal direction from the hidden segment position', () => {
    const gap = buildContextGaps(file)[1];
    const topGap = buildContextGaps(file)[0];
    const fullTopSegment = expandedContextSegments(topGap, undefined)[0];
    const fullMiddleSegment = expandedContextSegments(gap, undefined)[0];
    if (fullTopSegment?.type !== 'hidden' || fullMiddleSegment?.type !== 'hidden') {
      throw new Error('Expected hidden segments');
    }

    expect(contextExpansionDirectionForSegment(topGap, fullTopSegment)).toBe('up');
    expect(contextExpansionDirectionForSegment(gap, fullMiddleSegment)).toBe('all');

    const withTop = mergeContextLines(gap, undefined, contextLines(5, 3));
    const bottomSegment = expandedContextSegments(gap, withTop)[1];
    if (bottomSegment?.type !== 'hidden') {
      throw new Error('Expected hidden segment below revealed context');
    }
    expect(contextExpansionDirectionForSegment(gap, bottomSegment)).toBe('down');

    const withBottom = mergeContextLines(gap, undefined, contextLines(12, 3));
    const topSegment = expandedContextSegments(gap, withBottom)[0];
    if (topSegment?.type !== 'hidden') {
      throw new Error('Expected hidden segment above revealed context');
    }
    expect(contextExpansionDirectionForSegment(gap, topSegment)).toBe('up');

    const withTopAndBottom = mergeContextLines(gap, withTop, contextLines(12, 3));
    const middleSegment = expandedContextSegments(gap, withTopAndBottom)[1];
    if (middleSegment?.type !== 'hidden') {
      throw new Error('Expected hidden segment between revealed context');
    }
    expect(contextExpansionDirectionForSegment(gap, middleSegment)).toBe('all');
  });

  it('builds directional requests from the remaining hidden window', () => {
    const gap = buildContextGaps(file)[1];
    expect(contextExpansionRequest(gap, undefined, 'down', 3)).toEqual({
      oldStart: 5,
      newStart: 5,
      lineCount: 3
    });

    const withTop = mergeContextLines(gap, undefined, contextLines(5, 3));
    expect(contextExpansionRequest(gap, withTop, 'down', 3)).toEqual({
      oldStart: 8,
      newStart: 8,
      lineCount: 3
    });
    expect(contextExpansionRequest(gap, withTop, 'up', 3)).toEqual({
      oldStart: 12,
      newStart: 12,
      lineCount: 3
    });

    const withTopAndBottom = mergeContextLines(gap, withTop, contextLines(12, 3));
    expect(contextExpansionRequest(gap, withTopAndBottom, 'all', 3)).toEqual({
      oldStart: 8,
      newStart: 8,
      lineCount: 4
    });
  });

  it('caps expand-all requests to the server context limit', () => {
    const largeFile: DiffFile = {
      ...file,
      hunks: [
        {
          oldStart: 701,
          oldLines: 1,
          newStart: 701,
          newLines: 1,
          header: '',
          lines: [{ type: 'context', oldLine: 701, newLine: 701, content: 'line 701' }]
        }
      ]
    };
    const gap = buildContextGaps(largeFile)[0];

    expect(contextExpansionRequest(gap, undefined, 'all')).toEqual({
      oldStart: 1,
      newStart: 1,
      lineCount: DIFF_CONTEXT_MAX_LINES
    });
  });

  it('merges context lines without duplicates and tracks the remaining hidden count', () => {
    const gap = buildContextGaps(file)[1];
    const withContext = mergeContextLines(gap, undefined, contextLines(5, 3));
    const withDuplicateContext = mergeContextLines(gap, withContext, contextLines(5, 3));

    expect(contextLinesForGap(gap, withDuplicateContext).map((line) => line.oldLine)).toEqual([
      5, 6, 7
    ]);
    expect(expandedContextSegments(gap, withDuplicateContext)).toMatchObject([
      { type: 'lines', lines: contextLines(5, 3) },
      { type: 'hidden', oldStart: 8, newStart: 8, lineCount: 7 }
    ]);
  });

  it('keeps revealed top and bottom context around a single hidden segment', () => {
    const gap = buildContextGaps(file)[1];
    const withTop = mergeContextLines(gap, undefined, contextLines(5, 3));
    const withTopAndBottom = mergeContextLines(gap, withTop, contextLines(12, 3));

    expect(expandedContextSegments(gap, withTopAndBottom)).toEqual([
      { type: 'lines', lines: contextLines(5, 3) },
      { type: 'hidden', oldStart: 8, newStart: 8, lineCount: 4 },
      { type: 'lines', lines: contextLines(12, 3) }
    ]);
  });

  it('orders expanded context before the hunk it belongs to', () => {
    const topGap = buildContextGaps(file)[0];
    const betweenGap = buildContextGaps(file)[1];
    const visible = visibleDiffLines(file, {
      [topGap.id]: mergeContextLines(topGap, undefined, contextLines(1, 2)),
      [betweenGap.id]: mergeContextLines(betweenGap, undefined, contextLines(5, 2))
    });

    expect(visible.map((line) => line.content)).toEqual([
      'line 1',
      'line 2',
      'line 3',
      'line 4 new',
      'line 5',
      'line 6',
      'line 15 old',
      'line 16'
    ]);
  });
});
