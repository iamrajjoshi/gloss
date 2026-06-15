import {
  DIFF_CONTEXT_MAX_LINES,
  type DiffFile,
  type DiffHunk,
  type DiffLine
} from '../../shared/types';

const CONTEXT_EXPAND_CHUNK_SIZE = 20;

export type ContextExpansionDirection = 'up' | 'down' | 'all';

export interface DiffContextGap {
  id: string;
  beforeHunkIndex: number;
  filePath: string;
  oldPath: string | null;
  oldStart: number;
  newStart: number;
  lineCount: number;
}

export interface DiffContextGapState {
  lines: DiffLine[];
  loading: boolean;
  error: string | null;
}

export type DiffContextStateByGap = Record<string, DiffContextGapState | undefined>;

export interface DiffContextRequestWindow {
  oldStart: number;
  newStart: number;
  lineCount: number;
}

export type DiffContextSegment =
  | { type: 'lines'; lines: DiffLine[] }
  | { type: 'hidden'; oldStart: number; newStart: number; lineCount: number };

export function contextExpansionDirectionForSegment(
  gap: DiffContextGap,
  segment: Extract<DiffContextSegment, { type: 'hidden' }>
): ContextExpansionDirection {
  const startOffset = segment.oldStart - gap.oldStart;
  const endOffset = startOffset + segment.lineCount - 1;
  const hasVisibleContextAbove = startOffset > 0;
  const hasVisibleContextBelow = endOffset < gap.lineCount - 1;

  if (hasVisibleContextAbove && hasVisibleContextBelow) {
    return 'all';
  }
  if (hasVisibleContextAbove) {
    return 'down';
  }
  if (hasVisibleContextBelow) {
    return 'up';
  }

  return gap.beforeHunkIndex === 0 ? 'up' : 'all';
}

export function buildContextGaps(file: DiffFile): DiffContextGap[] {
  const gaps: DiffContextGap[] = [];
  let previousOldEnd = 0;
  let previousNewEnd = 0;

  file.hunks.forEach((hunk, index) => {
    const oldGap = hunk.oldStart > previousOldEnd + 1 ? hunk.oldStart - previousOldEnd - 1 : 0;
    const newGap = hunk.newStart > previousNewEnd + 1 ? hunk.newStart - previousNewEnd - 1 : 0;
    const lineCount = Math.min(oldGap, newGap);
    if (lineCount > 0) {
      const oldStart = previousOldEnd + 1;
      const newStart = previousNewEnd + 1;
      gaps.push({
        id: `${file.path}:${oldStart}:${newStart}:${lineCount}`,
        beforeHunkIndex: index,
        filePath: file.path,
        oldPath: file.oldPath,
        oldStart,
        newStart,
        lineCount
      });
    }
    previousOldEnd = hunk.oldStart + hunk.oldLines - 1;
    previousNewEnd = hunk.newStart + hunk.newLines - 1;
  });

  return gaps;
}

export function expandedContextSegments(
  gap: DiffContextGap,
  state: Pick<DiffContextGapState, 'lines'> | undefined
): DiffContextSegment[] {
  const linesByOffset = contextLinesByOffset(gap, state);
  const missingOffsets = missingContextOffsets(gap, linesByOffset);
  const lines = contextLinesForGap(gap, state);
  if (missingOffsets.length === 0) {
    return lines.length > 0 ? [{ type: 'lines', lines }] : [];
  }

  const firstMissing = missingOffsets[0] ?? 0;
  const lastMissing = missingOffsets.at(-1) ?? gap.lineCount - 1;
  const before = lines.filter((line) => {
    const offset = contextLineOffset(gap, line);
    return offset != null && offset < firstMissing;
  });
  const after = lines.filter((line) => {
    const offset = contextLineOffset(gap, line);
    return offset != null && offset > lastMissing;
  });
  return [
    ...(before.length > 0 ? [{ type: 'lines' as const, lines: before }] : []),
    {
      type: 'hidden',
      oldStart: gap.oldStart + firstMissing,
      newStart: gap.newStart + firstMissing,
      lineCount: lastMissing - firstMissing + 1
    },
    ...(after.length > 0 ? [{ type: 'lines' as const, lines: after }] : [])
  ];
}

export function contextExpansionRequest(
  gap: DiffContextGap,
  state: Pick<DiffContextGapState, 'lines'> | undefined,
  direction: ContextExpansionDirection,
  chunkSize = CONTEXT_EXPAND_CHUNK_SIZE
): DiffContextRequestWindow | null {
  const linesByOffset = contextLinesByOffset(gap, state);
  const missingOffsets = missingContextOffsets(gap, linesByOffset);
  if (missingOffsets.length === 0) {
    return null;
  }

  let startOffset: number;
  let endOffset: number;
  if (direction === 'all') {
    startOffset = missingOffsets[0] ?? 0;
    endOffset = missingOffsets.at(-1) ?? gap.lineCount - 1;
    endOffset = Math.min(endOffset, startOffset + DIFF_CONTEXT_MAX_LINES - 1);
  } else if (direction === 'down') {
    startOffset = missingOffsets[0] ?? 0;
    endOffset = startOffset;
    while (endOffset + 1 < gap.lineCount && !linesByOffset.has(endOffset + 1)) {
      endOffset += 1;
    }
    endOffset = Math.min(endOffset, startOffset + chunkSize - 1);
  } else {
    endOffset = missingOffsets.at(-1) ?? gap.lineCount - 1;
    startOffset = endOffset;
    while (startOffset - 1 >= 0 && !linesByOffset.has(startOffset - 1)) {
      startOffset -= 1;
    }
    startOffset = Math.max(startOffset, endOffset - chunkSize + 1);
  }

  return {
    oldStart: gap.oldStart + startOffset,
    newStart: gap.newStart + startOffset,
    lineCount: endOffset - startOffset + 1
  };
}

export function mergeContextLines(
  gap: DiffContextGap,
  state: DiffContextGapState | undefined,
  lines: DiffLine[]
): DiffContextGapState {
  const linesByOffset = contextLinesByOffset(gap, state);
  for (const line of lines) {
    const offset = contextLineOffset(gap, line);
    if (offset != null) {
      linesByOffset.set(offset, line);
    }
  }
  return {
    lines: Array.from(linesByOffset.entries())
      .toSorted(([left], [right]) => left - right)
      .map(([, line]) => line),
    loading: false,
    error: null
  };
}

export function contextLinesForGap(
  gap: DiffContextGap,
  state: Pick<DiffContextGapState, 'lines'> | undefined
): DiffLine[] {
  return Array.from(contextLinesByOffset(gap, state).entries())
    .toSorted(([left], [right]) => left - right)
    .map(([, line]) => line);
}

export function visibleDiffLines(file: DiffFile, stateByGap: DiffContextStateByGap): DiffLine[] {
  const gapsByHunkIndex = new Map(buildContextGaps(file).map((gap) => [gap.beforeHunkIndex, gap]));
  return file.hunks.flatMap((hunk, index) => {
    const gap = gapsByHunkIndex.get(index);
    return [...(gap ? contextLinesForGap(gap, stateByGap[gap.id]) : []), ...hunk.lines];
  });
}

export function fileWithExpandedContext(
  file: DiffFile,
  stateByGap: DiffContextStateByGap
): DiffFile {
  const gapsByHunkIndex = new Map(buildContextGaps(file).map((gap) => [gap.beforeHunkIndex, gap]));
  const hunks: DiffHunk[] = file.hunks.map((hunk, index) => {
    const gap = gapsByHunkIndex.get(index);
    const contextLines = gap ? contextLinesForGap(gap, stateByGap[gap.id]) : [];
    return contextLines.length > 0 ? { ...hunk, lines: [...contextLines, ...hunk.lines] } : hunk;
  });
  return { ...file, hunks };
}

function missingContextOffsets(
  gap: DiffContextGap,
  linesByOffset: Map<number, DiffLine>
): number[] {
  const missing: number[] = [];
  for (let offset = 0; offset < gap.lineCount; offset += 1) {
    if (!linesByOffset.has(offset)) {
      missing.push(offset);
    }
  }
  return missing;
}

function contextLinesByOffset(
  gap: DiffContextGap | undefined,
  state: Pick<DiffContextGapState, 'lines'> | undefined
): Map<number, DiffLine> {
  const linesByOffset = new Map<number, DiffLine>();
  if (!gap || !state) {
    return linesByOffset;
  }

  for (const line of state.lines) {
    const offset = contextLineOffset(gap, line);
    if (offset != null) {
      linesByOffset.set(offset, line);
    }
  }
  return linesByOffset;
}

function contextLineOffset(gap: DiffContextGap, line: DiffLine): number | null {
  const oldOffset = line.oldLine == null ? null : line.oldLine - gap.oldStart;
  if (oldOffset != null && oldOffset >= 0 && oldOffset < gap.lineCount) {
    return oldOffset;
  }

  const newOffset = line.newLine == null ? null : line.newLine - gap.newStart;
  if (newOffset != null && newOffset >= 0 && newOffset < gap.lineCount) {
    return newOffset;
  }

  return null;
}
