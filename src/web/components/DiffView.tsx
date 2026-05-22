import { parsePatchFiles } from '@pierre/diffs';
import { MessageSquare } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiffFile, DiffLine, ReviewRecord, Side } from '../../shared/types';
import { useReviewStore } from '../store';
import { CommentPopover } from './CommentPopover';
import { FileHeader } from './FileHeader';

interface RowRef {
  filePath: string;
  side: Side;
  line: number;
  snippet: string;
}

interface SelectionRef {
  start: RowRef;
  end: RowRef;
}

export function DiffView({ record }: { record: ReviewRecord }) {
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const pierreFiles = useMemo(() => {
    try {
      return parsePatchFiles(record.diff.rawDiff, record.meta.id).flatMap((patch) => patch.files)
        .length;
    } catch {
      return 0;
    }
  }, [record.diff.rawDiff, record.meta.id]);

  return (
    <section className="diff-stack" data-pierre-files={pierreFiles}>
      {record.diff.files.length === 0 ? (
        <EmptyDiff record={record} />
      ) : (
        record.diff.files.map((file) => {
          const collapsed = collapsedFiles.has(file.path);
          return (
            <article className="file-card" key={`${file.oldPath ?? file.path}:${file.path}`}>
              <FileHeader
                file={file}
                collapsed={collapsed}
                onToggle={() =>
                  setCollapsedFiles((current) => {
                    const next = new Set(current);
                    next.has(file.path) ? next.delete(file.path) : next.add(file.path);
                    return next;
                  })
                }
              />
              {collapsed ? null : <DiffFileTable file={file} />}
            </article>
          );
        })
      )}
    </section>
  );
}

function EmptyDiff({ record }: { record: ReviewRecord }) {
  const scope = record.diff.scope;
  if (scope.mode === 'branch') {
    return (
      <div className="empty-diff">
        <h2>No branch changes</h2>
        <p>
          Working tree is clean, and {scope.comparison.ref} matches {scope.base.ref}.
        </p>
      </div>
    );
  }

  if (scope.fallbackReason === 'missing-branch-base') {
    return (
      <div className="empty-diff">
        <h2>No changes to review</h2>
        <p>Working tree is clean and no upstream or default branch ref was found.</p>
      </div>
    );
  }

  if (scope.mode === 'explicit') {
    return (
      <div className="empty-diff">
        <h2>No changes against {scope.base.ref}</h2>
        <p>The captured diff for this explicit base is empty.</p>
      </div>
    );
  }

  return (
    <div className="empty-diff">
      <h2>No working changes</h2>
      <p>Working tree is clean.</p>
    </div>
  );
}

function DiffFileTable({ file }: { file: DiffFile }) {
  const comments = useReviewStore((state) => state.comments);
  const draft = useReviewStore((state) => state.draft);
  const setDraft = useReviewStore((state) => state.setDraft);
  const [dragStart, setDragStart] = useState<RowRef | null>(null);
  const [dragEnd, setDragEnd] = useState<RowRef | null>(null);
  const selectionRef = useRef<SelectionRef | null>(null);
  const cleanupSelectionListeners = useRef<(() => void) | null>(null);
  const visualIndexByLine = useMemo(() => buildVisualIndex(file), [file]);
  let previousNewEnd = 0;

  const fileComments = comments.filter((comment) => comment.filePath === file.path);
  const dragVisualRange =
    dragStart && dragEnd && dragStart.filePath === file.path && dragStart.side === dragEnd.side
      ? visualRangeFor(visualIndexByLine, dragStart.side, dragStart.line, dragEnd.line)
      : null;
  const draftVisualRange =
    draft && draft.filePath === file.path
      ? visualRangeFor(visualIndexByLine, draft.side, draft.startLine, draft.endLine)
      : null;

  const openDraft = (selection: SelectionRef) => {
    const { start: row, end } = selection;
    const startLine = Math.min(row.line, end.line);
    const endLine = Math.max(row.line, end.line);
    const snippet = collectSnippet(file, row.side, startLine, endLine) || row.snippet;
    setDraft({
      filePath: file.path,
      side: row.side,
      startLine,
      endLine,
      originalSnippet: snippet
    });
  };

  useEffect(() => () => cleanupSelectionListeners.current?.(), []);

  const rowFromElement = (element: HTMLButtonElement): RowRef | null => {
    if (element.dataset.filePath !== file.path) {
      return null;
    }
    const side = element.dataset.side;
    const line = Number(element.dataset.line);
    if ((side !== 'L' && side !== 'R') || !Number.isFinite(line)) {
      return null;
    }

    return {
      filePath: file.path,
      side,
      line,
      snippet: element.querySelector('code')?.textContent ?? ''
    };
  };

  const extendSelectionFromElement = (element: HTMLButtonElement) => {
    const row = rowFromElement(element);
    if (row) {
      extendSelection(row);
    }
  };

  const startSelection = (row: RowRef, event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    cleanupSelectionListeners.current?.();
    selectionRef.current = {
      start: row,
      end: row
    };
    setDragStart(row);
    setDragEnd(row);

    const updateSelectionFromMouse = (event: MouseEvent) => {
      const element = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLButtonElement>('.diff-row');
      if (element) {
        extendSelectionFromElement(element);
      }
    };

    const finishSelection = (event: MouseEvent) => {
      updateSelectionFromMouse(event);
      const selection = selectionRef.current;
      if (selection) {
        openDraft(selection);
      }
      cancelSelection();
    };
    const cancel = () => cancelSelection();
    window.addEventListener('mousemove', updateSelectionFromMouse);
    window.addEventListener('mouseup', finishSelection);
    window.addEventListener('blur', cancel);
    cleanupSelectionListeners.current = () => {
      window.removeEventListener('mousemove', updateSelectionFromMouse);
      window.removeEventListener('mouseup', finishSelection);
      window.removeEventListener('blur', cancel);
      cleanupSelectionListeners.current = null;
    };
  };

  const extendSelection = (row: RowRef) => {
    const selection = selectionRef.current;
    if (selection?.start.filePath === file.path && selection.start.side === row.side) {
      selectionRef.current = { ...selection, end: row };
      setDragEnd(row);
    }
  };

  const cancelSelection = () => {
    cleanupSelectionListeners.current?.();
    selectionRef.current = null;
    setDragStart(null);
    setDragEnd(null);
  };

  return (
    <fieldset className="diff-table">
      <legend className="sr-only">{file.path} diff</legend>
      {file.isBinary ? <div className="binary-note">Binary file changed</div> : null}
      {file.hunks.map((hunk) => {
        const hidden = hunk.newStart > previousNewEnd + 1 ? hunk.newStart - previousNewEnd - 1 : 0;
        previousNewEnd = hunk.newStart + hunk.newLines - 1;
        return (
          <div className="hunk" key={`${hunk.oldStart}:${hunk.newStart}`}>
            {hidden > 0 ? (
              <button className="hidden-lines" type="button">
                {hidden} unmodified lines
              </button>
            ) : null}
            <div className="hunk-header">
              {hunk.header ||
                `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
            </div>
            {hunk.lines.map((line) => {
              const side = sideForLine(line);
              const lineNumber = side === 'L' ? line.oldLine : line.newLine;
              if (lineNumber == null) {
                return null;
              }
              const row: RowRef = {
                filePath: file.path,
                side,
                line: lineNumber,
                snippet: line.content
              };
              const visualIndex = visualIndexByLine.get(rowKey(side, lineNumber));
              const selected =
                visualIndex != null &&
                (isInVisualRange(visualIndex, dragVisualRange) ||
                  isInVisualRange(visualIndex, draftVisualRange));
              const showDraftComposer =
                draft &&
                draft.filePath === file.path &&
                draft.side === side &&
                lineNumber === draft.endLine;
              const rowComments = fileComments.filter(
                (comment) =>
                  comment.side === side &&
                  lineNumber >= comment.startLine &&
                  lineNumber <= comment.endLine
              );
              return (
                <div
                  key={`${line.type}:${line.oldLine ?? 'x'}:${line.newLine ?? 'x'}:${line.content}`}
                >
                  <button
                    className={`diff-row ${line.type} ${selected ? 'selected' : ''}`}
                    data-file-path={file.path}
                    data-line={lineNumber}
                    data-side={side}
                    type="button"
                    onMouseDown={(event) => startSelection(row, event)}
                    onMouseEnter={(event) => extendSelectionFromElement(event.currentTarget)}
                  >
                    <span className="line-number old">{line.oldLine ?? ''}</span>
                    <span className="line-number new">{line.newLine ?? ''}</span>
                    <span className="marker">{markerForLine(line)}</span>
                    <code>{line.content || ' '}</code>
                  </button>
                  {rowComments.map((comment) => (
                    <div className="inline-comment" key={comment.id}>
                      <MessageSquare size={14} />
                      <span>{comment.body}</span>
                    </div>
                  ))}
                  {showDraftComposer ? (
                    <div className="draft-comment-row">
                      <CommentPopover />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </fieldset>
  );
}

function markerForLine(line: DiffLine): string {
  if (line.type === 'add') {
    return '+';
  }
  if (line.type === 'delete') {
    return '-';
  }
  return ' ';
}

function sideForLine(line: DiffLine): Side {
  return line.type === 'delete' ? 'L' : 'R';
}

function buildVisualIndex(file: DiffFile): Map<string, number> {
  const indexByLine = new Map<string, number>();
  let visualIndex = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const side = sideForLine(line);
      const lineNumber = side === 'L' ? line.oldLine : line.newLine;
      if (lineNumber != null) {
        indexByLine.set(rowKey(side, lineNumber), visualIndex);
        visualIndex += 1;
      }
    }
  }
  return indexByLine;
}

function rowKey(side: Side, line: number): string {
  return `${side}:${line}`;
}

function visualRangeFor(
  indexByLine: Map<string, number>,
  side: Side,
  startLine: number,
  endLine: number
): { start: number; end: number } | null {
  const startIndex = indexByLine.get(rowKey(side, startLine));
  const endIndex = indexByLine.get(rowKey(side, endLine));
  if (startIndex == null || endIndex == null) {
    return null;
  }
  return {
    start: Math.min(startIndex, endIndex),
    end: Math.max(startIndex, endIndex)
  };
}

function isInVisualRange(index: number, range: { start: number; end: number } | null): boolean {
  return Boolean(range && index >= range.start && index <= range.end);
}

function collectSnippet(file: DiffFile, side: Side, startLine: number, endLine: number): string {
  const lines: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const lineNumber = side === 'L' ? line.oldLine : line.newLine;
      const lineSide = sideForLine(line);
      if (
        lineSide === side &&
        lineNumber != null &&
        lineNumber >= startLine &&
        lineNumber <= endLine
      ) {
        lines.push(line.content);
      }
    }
  }
  return lines.join('\n');
}
