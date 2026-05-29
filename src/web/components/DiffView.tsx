import { CheckCircle2, MessageSquare, Plus } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLineKey, diffLineNumber, diffLineSide } from '../../shared/diff-lines';
import type { DiffFile, DiffLine, DiffPayload, ReviewRecord, Side } from '../../shared/types';
import { useReviewStore } from '../store';
import type { HighlightedDiffLines, SyntaxToken } from '../syntax';
import { CommentComposer } from './CommentPopover';
import { fileCardElementId } from './diff-view-helpers';
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

export function DiffView({
  activeFilePath = null,
  emptyState = null,
  files,
  record,
  diff = record.diff,
  readOnly = false,
  wrapLines = false,
  viewedFiles = new Set<string>(),
  onViewedChange = () => undefined,
  onOpenFile = () => undefined
}: {
  activeFilePath?: string | null;
  emptyState?: ReactNode;
  files?: DiffFile[];
  record: ReviewRecord;
  diff?: Pick<DiffPayload, 'files'>;
  readOnly?: boolean;
  wrapLines?: boolean;
  viewedFiles?: Set<string>;
  onViewedChange?: (filePath: string, viewed: boolean) => void;
  onOpenFile?: (filePath: string) => void;
}) {
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const draft = useReviewStore((state) => state.draft);
  const setDraft = useReviewStore((state) => state.setDraft);
  const renderedFiles = files ?? diff.files;

  useEffect(() => {
    if (!activeFilePath) {
      return;
    }
    setCollapsedFiles((current) => {
      if (!current.has(activeFilePath)) {
        return current;
      }
      const next = new Set(current);
      next.delete(activeFilePath);
      return next;
    });
  }, [activeFilePath]);

  const handleViewedChange = (filePath: string, viewed: boolean) => {
    if (viewed) {
      if (draft?.filePath === filePath) {
        setDraft(null);
      }
      setCollapsedFiles((current) => {
        const next = new Set(current);
        next.add(filePath);
        return next;
      });
    }
    onViewedChange(filePath, viewed);
  };

  return (
    <section className="diff-stack">
      {renderedFiles.length === 0
        ? (emptyState ?? <EmptyDiff record={record} />)
        : renderedFiles.map((file) => {
            const collapsed = collapsedFiles.has(file.path);
            return (
              <article
                className={`file-card ${activeFilePath === file.path ? 'active' : ''}`}
                id={fileCardElementId(file.path)}
                key={`${file.oldPath ?? file.path}:${file.path}`}
              >
                <FileHeader
                  file={file}
                  collapsed={collapsed}
                  viewed={viewedFiles.has(file.path)}
                  onToggle={() => {
                    if (!collapsed && draft?.filePath === file.path) {
                      setDraft(null);
                    }
                    setCollapsedFiles((current) => {
                      const next = new Set(current);
                      next.has(file.path) ? next.delete(file.path) : next.add(file.path);
                      return next;
                    });
                  }}
                  onViewedChange={(viewed) => handleViewedChange(file.path, viewed)}
                  onOpenFile={() => onOpenFile(file.path)}
                />
                {collapsed ? null : (
                  <DiffFileTable file={file} readOnly={readOnly} wrapLines={wrapLines} />
                )}
              </article>
            );
          })}
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

function DiffFileTable({
  file,
  readOnly,
  wrapLines
}: {
  file: DiffFile;
  readOnly: boolean;
  wrapLines: boolean;
}) {
  const comments = useReviewStore((state) => state.comments);
  const resolution = useReviewStore((state) => state.resolution);
  const draft = useReviewStore((state) => state.draft);
  const setDraft = useReviewStore((state) => state.setDraft);
  const [dragStart, setDragStart] = useState<RowRef | null>(null);
  const [dragEnd, setDragEnd] = useState<RowRef | null>(null);
  const [highlightedLines, setHighlightedLines] = useState<HighlightedDiffLines | null>(null);
  const selectionRef = useRef<SelectionRef | null>(null);
  const cleanupSelectionListeners = useRef<(() => void) | null>(null);
  const visualIndexByLine = useMemo(() => buildVisualIndex(file), [file]);
  const resolvedByCommentId = useMemo(
    () => new Map((resolution?.comments ?? []).map((comment) => [comment.commentId, comment])),
    [resolution]
  );
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
    const snippet =
      collectVisualSnippet(file, visualIndexByLine, row.side, startLine, endLine) || row.snippet;
    setDraft({
      filePath: file.path,
      side: row.side,
      startLine,
      endLine,
      originalSnippet: snippet
    });
  };

  useEffect(() => () => cleanupSelectionListeners.current?.(), []);

  const rowFromElement = (element: HTMLElement): RowRef | null => {
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

  const extendSelectionFromElement = (element: HTMLElement) => {
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
        ?.closest<HTMLElement>('.diff-row');
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

  const openSingleLineDraftFromKeyboard = (
    row: RowRef,
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    if (event.repeat || event.defaultPrevented || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    cleanupSelectionListeners.current?.();
    selectionRef.current = null;
    setDragStart(null);
    setDragEnd(null);
    openDraft({ start: row, end: row });
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

  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(null);
    import('../syntax')
      .then(({ highlightDiffFile }) => highlightDiffFile(file))
      .then((nextHighlightedLines) => {
        if (!cancelled) {
          setHighlightedLines(nextHighlightedLines);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedLines(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <section
      aria-label={`${file.path} diff`}
      className={`diff-scroller ${wrapLines ? 'wrap-lines' : ''}`}
      key={wrapLines ? 'wrapped' : 'unwrapped'}
    >
      <div className={`diff-table ${dragStart ? 'selecting' : ''}`}>
        {file.isBinary ? <div className="binary-note">Binary file changed</div> : null}
        {file.hunks.map((hunk) => {
          const hidden =
            hunk.newStart > previousNewEnd + 1 ? hunk.newStart - previousNewEnd - 1 : 0;
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
                const side = diffLineSide(line);
                const lineNumber = diffLineNumber(line);
                if (lineNumber == null) {
                  return null;
                }
                const row: RowRef = {
                  filePath: file.path,
                  side,
                  line: lineNumber,
                  snippet: line.content
                };
                const visualIndex = visualIndexByLine.get(diffLineKey(side, lineNumber));
                const activeVisualRange =
                  visualIndex != null && isInVisualRange(visualIndex, dragVisualRange)
                    ? dragVisualRange
                    : visualIndex != null && isInVisualRange(visualIndex, draftVisualRange)
                      ? draftVisualRange
                      : null;
                const selectionClass =
                  visualIndex != null && activeVisualRange
                    ? selectionClassForLine(
                        visualIndex,
                        activeVisualRange.start,
                        activeVisualRange.end
                      )
                    : '';
                const showDraftComposer =
                  draft &&
                  draft.filePath === file.path &&
                  draft.side === side &&
                  lineNumber === draft.endLine;
                const rowComments = fileComments.filter(
                  (comment) =>
                    comment.side === side &&
                    lineNumber === Math.max(comment.startLine, comment.endLine)
                );
                return (
                  <div
                    key={`${line.type}:${line.oldLine ?? 'x'}:${line.newLine ?? 'x'}:${line.content}`}
                  >
                    <div
                      className={`diff-row ${line.type} ${readOnly ? 'read-only' : ''} ${selectionClass} ${showDraftComposer ? 'range-continues' : ''}`}
                      data-file-path={file.path}
                      data-line={lineNumber}
                      data-side={side}
                    >
                      {selectionClass ? (
                        <span className="selection-rail" aria-hidden="true" />
                      ) : null}
                      <div className="diff-gutter">
                        <span className="line-number old">{line.oldLine ?? ''}</span>
                        <span className="line-number new">{line.newLine ?? ''}</span>
                        <span className="marker">{markerForLine(line)}</span>
                        {!readOnly ? (
                          <button
                            aria-label={`Comment on ${file.path} line ${lineNumber}`}
                            className="comment-handle"
                            type="button"
                            onMouseDown={(event) => startSelection(row, event)}
                            onKeyDown={(event) => openSingleLineDraftFromKeyboard(row, event)}
                          >
                            <Plus size={16} strokeWidth={2.4} />
                          </button>
                        ) : null}
                      </div>
                      <CodeLine
                        content={line.content}
                        tokens={highlightedLines?.get(diffLineKey(side, lineNumber)) ?? null}
                      />
                    </div>
                    {rowComments.map((comment) => {
                      const resolvedComment = resolvedByCommentId.get(comment.id);
                      return (
                        <div
                          className={`inline-comment ${resolvedComment ? 'resolved' : 'open'}`}
                          key={comment.id}
                        >
                          {resolvedComment ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <MessageSquare size={14} />
                          )}
                          <span className="inline-comment-content">
                            {readOnly ? (
                              <span className="inline-comment-status">
                                {resolvedComment ? 'Resolved' : 'Open · Needs fix'}
                              </span>
                            ) : null}
                            <span className="inline-comment-body">{comment.body}</span>
                            {resolvedComment?.summary ? (
                              <span className="inline-comment-summary">
                                {resolvedComment.summary}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      );
                    })}
                    {showDraftComposer && !readOnly ? <CommentComposer tone={line.type} /> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CodeLine({ content, tokens }: { content: string; tokens: SyntaxToken[] | null }) {
  if (!tokens || tokens.length === 0) {
    return <code>{content || ' '}</code>;
  }

  return (
    <code>
      {tokens.map((token) => (
        <span key={`${token.offset}:${token.content}`} style={styleForToken(token)}>
          {token.content}
        </span>
      ))}
    </code>
  );
}

function styleForToken(token: SyntaxToken): CSSProperties {
  const style: CSSProperties = {};
  if (token.color) {
    style.color = token.color;
  }
  if (token.fontStyle && (token.fontStyle & 1) !== 0) {
    style.fontStyle = 'italic';
  }
  if (token.fontStyle && (token.fontStyle & 2) !== 0) {
    style.fontWeight = 700;
  }
  const textDecoration = [];
  if (token.fontStyle && (token.fontStyle & 4) !== 0) {
    textDecoration.push('underline');
  }
  if (token.fontStyle && (token.fontStyle & 8) !== 0) {
    textDecoration.push('line-through');
  }
  if (textDecoration.length > 0) {
    style.textDecorationLine = textDecoration.join(' ');
  }
  return style;
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

function selectionClassForLine(lineNumber: number, startLine: number, endLine: number): string {
  if (startLine === endLine) {
    return 'range-selected range-single';
  }
  if (lineNumber === startLine) {
    return 'range-selected range-start';
  }
  if (lineNumber === endLine) {
    return 'range-selected range-end';
  }
  return 'range-selected range-middle';
}

function buildVisualIndex(file: DiffFile): Map<string, number> {
  const indexByLine = new Map<string, number>();
  let visualIndex = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const side = diffLineSide(line);
      const lineNumber = diffLineNumber(line);
      if (lineNumber != null) {
        indexByLine.set(diffLineKey(side, lineNumber), visualIndex);
        visualIndex += 1;
      }
    }
  }
  return indexByLine;
}

function visualRangeFor(
  indexByLine: Map<string, number>,
  side: Side,
  startLine: number,
  endLine: number
): { start: number; end: number } | null {
  const startIndex = indexByLine.get(diffLineKey(side, startLine));
  const endIndex = indexByLine.get(diffLineKey(side, endLine));
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

function collectVisualSnippet(
  file: DiffFile,
  indexByLine: Map<string, number>,
  side: Side,
  startLine: number,
  endLine: number
): string {
  const selectedLines: DiffLine[] = [];
  const range = visualRangeFor(indexByLine, side, startLine, endLine);
  if (!range) {
    return '';
  }
  let visualIndex = 0;

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (diffLineNumber(line) == null) {
        continue;
      }
      if (visualIndex >= range.start && visualIndex <= range.end) {
        selectedLines.push(line);
      }
      visualIndex += 1;
    }
  }

  const hasMixedLineTypes = new Set(selectedLines.map((line) => line.type)).size > 1;
  return selectedLines
    .map((line) => (hasMixedLineTypes ? `${markerForLine(line)}${line.content}` : line.content))
    .join('\n');
}
