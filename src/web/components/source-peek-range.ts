import {
  SOURCE_PEEK_RANGE_MAX_LINES,
  type SourcePeekRangeResponse,
  type SourcePeekResponse
} from '../../shared/types';

export type SourcePeekRangeDirection = 'above' | 'below';

export interface LoadedSourcePeek {
  response: SourcePeekResponse;
  content: string;
  startLine: number;
  totalLines: number;
  truncated: boolean;
  hasMoreAbove: boolean;
  hasMoreBelow: boolean;
}

export interface SourcePeekRangeRequestWindow {
  startLine: number;
  lineCount: number;
}

export function initialLoadedSource(response: SourcePeekResponse): LoadedSourcePeek {
  return {
    response,
    content: response.content,
    startLine: response.startLine,
    totalLines: response.totalLines,
    truncated: response.truncated,
    hasMoreAbove: response.hasMoreAbove,
    hasMoreBelow: response.hasMoreBelow
  };
}

export function sourcePeekRangeRequest(
  loaded: LoadedSourcePeek,
  direction: SourcePeekRangeDirection,
  chunkSize = SOURCE_PEEK_RANGE_MAX_LINES
): SourcePeekRangeRequestWindow | null {
  if (direction === 'above') {
    if (!loaded.hasMoreAbove) {
      return null;
    }
    const startLine = Math.max(1, loaded.startLine - chunkSize);
    const lineCount = loaded.startLine - startLine;
    return lineCount > 0 ? { startLine, lineCount } : null;
  }

  if (!loaded.hasMoreBelow) {
    return null;
  }
  const startLine = loadedSourceEndLine(loaded) + 1;
  const lineCount = Math.min(chunkSize, loaded.totalLines - startLine + 1);
  return lineCount > 0 ? { startLine, lineCount } : null;
}

export function mergeLoadedSourceRange(
  loaded: LoadedSourcePeek,
  range: SourcePeekRangeResponse
): LoadedSourcePeek {
  const linesByNumber = new Map<number, string>();
  for (const [index, line] of splitSourceLines(loaded.content).entries()) {
    linesByNumber.set(loaded.startLine + index, line);
  }
  for (const [index, line] of splitSourceLines(range.content).entries()) {
    linesByNumber.set(range.startLine + index, line);
  }

  const entries = Array.from(linesByNumber.entries()).toSorted(([left], [right]) => left - right);
  if (entries.length === 0) {
    return loaded;
  }

  const startLine = entries[0]?.[0] ?? loaded.startLine;
  const endLine = entries.at(-1)?.[0] ?? loadedSourceEndLine(loaded);
  const totalLines = Math.max(loaded.totalLines, range.totalLines);
  const hasMoreAbove = startLine > 1 && (loaded.hasMoreAbove || range.hasMoreAbove);
  const hasMoreBelow = endLine < totalLines && (loaded.hasMoreBelow || range.hasMoreBelow);
  const byteTruncated =
    (loaded.truncated && !loaded.hasMoreAbove && !loaded.hasMoreBelow) ||
    (range.truncated && !range.hasMoreAbove && !range.hasMoreBelow);

  return {
    response: loaded.response,
    content: entries.map(([, line]) => line).join('\n'),
    startLine,
    totalLines,
    truncated: byteTruncated || hasMoreAbove || hasMoreBelow,
    hasMoreAbove,
    hasMoreBelow
  };
}

export function loadedSourceEndLine(loaded: LoadedSourcePeek): number {
  return loaded.startLine + splitSourceLines(loaded.content).length - 1;
}

export function splitSourceLines(contents: string): string[] {
  const lines = contents.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines.length > 0 ? lines : [''];
}
