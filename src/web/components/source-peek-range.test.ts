import { describe, expect, it } from 'vitest';
import { SOURCE_PEEK_RANGE_MAX_LINES, type SourcePeekResponse } from '../../shared/types';
import {
  initialLoadedSource,
  mergeLoadedSourceRange,
  sourcePeekRangeRequest
} from './source-peek-range';

const response: SourcePeekResponse = {
  symbol: 'target',
  targetSymbol: 'target',
  filePath: 'api.ts',
  startLine: 241,
  line: 300,
  column: 13,
  language: 'ts',
  content: ['line 241', 'line 242', 'line 243'].join('\n'),
  truncated: true,
  totalLines: 500,
  hasMoreAbove: true,
  hasMoreBelow: true,
  matchReason: 'same-file'
};

describe('source peek range helpers', () => {
  it('requests adjacent windows above and below the loaded source', () => {
    const loaded = initialLoadedSource(response);

    expect(sourcePeekRangeRequest(loaded, 'above')).toEqual({
      startLine: 1,
      lineCount: SOURCE_PEEK_RANGE_MAX_LINES
    });
    expect(sourcePeekRangeRequest(loaded, 'below')).toEqual({
      startLine: 244,
      lineCount: SOURCE_PEEK_RANGE_MAX_LINES
    });
  });

  it('merges ranges in line order without duplicates', () => {
    const loaded = initialLoadedSource(response);
    const merged = mergeLoadedSourceRange(loaded, {
      filePath: 'api.ts',
      startLine: 239,
      totalLines: 500,
      content: ['line 239', 'line 240', 'line 241'].join('\n'),
      truncated: true,
      hasMoreAbove: true,
      hasMoreBelow: true
    });

    expect(merged.startLine).toBe(239);
    expect(merged.content.split('\n')).toEqual([
      'line 239',
      'line 240',
      'line 241',
      'line 242',
      'line 243'
    ]);
    expect(merged.hasMoreAbove).toBe(true);
    expect(merged.hasMoreBelow).toBe(true);
  });

  it('stops requesting once the whole file is loaded', () => {
    const loaded = initialLoadedSource({
      ...response,
      startLine: 1,
      content: ['line 1', 'line 2'].join('\n'),
      totalLines: 2,
      truncated: false,
      hasMoreAbove: false,
      hasMoreBelow: false
    });

    expect(sourcePeekRangeRequest(loaded, 'above')).toBeNull();
    expect(sourcePeekRangeRequest(loaded, 'below')).toBeNull();
  });
});
