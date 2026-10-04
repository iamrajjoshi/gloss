import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronsUpDown,
  ChevronUp,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isLineComment } from '../../shared/comments';
import { diffLineKey, diffLineSide } from '../../shared/diff-lines';
import type {
  DiffContextSource,
  DiffFile,
  DiffLine,
  DiffPayload,
  LineComment,
  OpenFileTarget,
  OpenFileTargetInfo,
  ReviewRecord,
  Side
} from '../../shared/types';
import { fetchDiffContext } from '../api';
import { isSubmitCommentShortcut } from '../shortcuts';
import { useReviewStore } from '../store';
import type { HighlightedDiffLines, SyntaxToken } from '../syntax';
import { useTheme } from '../theme';
import { CommentComposer } from './CommentPopover';
import {
  buildContextGaps,
  type ContextExpansionDirection,
  contextExpansionDirectionsForSegment,
  contextExpansionRequest,
  type DiffContextGap,
  type DiffContextSegment,
  type DiffContextStateByGap,
  expandedContextSegments,
  fileWithExpandedContext,
  mergeContextLines,
  visibleDiffLines
} from './diff-context';
import {
  buildDiffVisualIndex,
  clampSplitPanePercentage,
  DEFAULT_SPLIT_PANE_PERCENTAGE,
  type DiffViewMode,
  diffLineMarker,
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

export interface SourcePeekTrigger {
  column: number;
  filePath: string;
  line: number;
  oldPath: string | null;
  side: Side;
  symbol: string;
}

const EMPTY_OPEN_TARGETS: OpenFileTargetInfo[] = [];

export interface HiddenDiffInfo {
  presetLabels: string[];
}

export function DiffView({
  activeFilePath = null,
  contextSource,
  emptyState = null,
  files,
  record,
  diff = record.diff,
  readOnly = false,
  reviewId,
  turnId,
  viewMode = 'unified',
  wrapLines = false,
  viewedFiles = new Set<string>(),
  onViewedChange = () => undefined,
  openTargets = EMPTY_OPEN_TARGETS,
  selectedSourcePeek = null,
  onCopyFileContents,
  onOpenFile = () => undefined,
  onSourcePeek = () => undefined,
  hiddenFiles = new Map<string, HiddenDiffInfo>(),
  onRevealHiddenFile = () => undefined
}: {
  activeFilePath?: string | null;
  contextSource?: DiffContextSource;
  emptyState?: ReactNode;
  files?: DiffFile[];
  record: ReviewRecord;
  diff?: Pick<DiffPayload, 'files'>;
  readOnly?: boolean;
  reviewId?: string;
  selectedSourcePeek?: SourcePeekTrigger | null;
  turnId?: string;
  viewMode?: DiffViewMode;
  wrapLines?: boolean;
  viewedFiles?: Set<string>;
  onViewedChange?: (filePath: string, viewed: boolean) => void;
  openTargets?: OpenFileTargetInfo[];
  onCopyFileContents?: (filePath: string) => Promise<string>;
  onOpenFile?: (filePath: string, target: OpenFileTarget) => void | Promise<void>;
  onSourcePeek?: (trigger: SourcePeekTrigger) => void;
  hiddenFiles?: Map<string, HiddenDiffInfo>;
  onRevealHiddenFile?: (filePath: string) => void;
}) {
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [splitPanePercentage, setSplitPanePercentage] = useState(DEFAULT_SPLIT_PANE_PERCENTAGE);
  const expandedActiveFilePath = useRef(activeFilePath);
  const diffStackRef = useRef<HTMLElement>(null);
  const draft = useReviewStore((state) => state.draft);
  const setDraft = useReviewStore((state) => state.setDraft);
  const renderedFiles = files ?? diff.files;

  const previewSplitPanePercentage = (percentage: number) => {
    const nextPercentage = clampSplitPanePercentage(percentage);
    const style = diffStackRef.current?.style;
    style?.setProperty('--diff-split-position', `${nextPercentage}%`);
    style?.setProperty('--diff-split-left-track', `${nextPercentage}fr`);
    style?.setProperty('--diff-split-right-track', `${100 - nextPercentage}fr`);
    return nextPercentage;
  };
  const commitSplitPanePercentage = (percentage: number) => {
    setSplitPanePercentage(previewSplitPanePercentage(percentage));
  };

  if (activeFilePath !== expandedActiveFilePath.current) {
    expandedActiveFilePath.current = activeFilePath;
    if (activeFilePath && collapsedFiles.has(activeFilePath)) {
      const nextCollapsedFiles = new Set(collapsedFiles);
      nextCollapsedFiles.delete(activeFilePath);
      setCollapsedFiles(nextCollapsedFiles);
    }
  }

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
    <section
      className="diff-stack"
      ref={diffStackRef}
      style={
        {
          '--diff-split-position': `${splitPanePercentage}%`,
          '--diff-split-left-track': `${splitPanePercentage}fr`,
          '--diff-split-right-track': `${100 - splitPanePercentage}fr`
        } as CSSProperties
      }
    >
      {renderedFiles.length === 0
        ? (emptyState ?? <EmptyDiff record={record} />)
        : renderedFiles.map((file) => {
            const collapsed = collapsedFiles.has(file.path);
            const hiddenInfo = hiddenFiles.get(file.path) ?? null;
            return (
              <article
                className={`file-card ${activeFilePath === file.path ? 'active' : ''}`}
                id={fileCardElementId(file.path)}
                key={`${file.oldPath ?? file.path}:${file.path}`}
              >
                <FileHeader
                  file={file}
                  openTargets={openTargets}
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
                  onCopyFileContents={
                    onCopyFileContents ? () => onCopyFileContents(file.path) : undefined
                  }
                  onViewedChange={(viewed) => handleViewedChange(file.path, viewed)}
                  onOpenFile={(target) => onOpenFile(file.path, target)}
                />
                {collapsed ? null : hiddenInfo ? (
                  <HiddenDiffPlaceholder
                    info={hiddenInfo}
                    onReveal={() => onRevealHiddenFile(file.path)}
                  />
                ) : (
                  <DiffFileTable
                    contextSource={contextSource}
                    file={file}
                    key={`${file.oldPath ?? ''}:${file.path}:${contextKey(
                      reviewId,
                      turnId,
                      contextSource
                    )}`}
                    readOnly={readOnly}
                    reviewId={reviewId}
                    selectedSourcePeek={selectedSourcePeek}
                    splitPanePercentage={splitPanePercentage}
                    turnId={turnId}
                    viewMode={viewMode}
                    wrapLines={wrapLines}
                    onSplitPaneChange={commitSplitPanePercentage}
                    onSplitPanePreview={previewSplitPanePercentage}
                    onSourcePeek={onSourcePeek}
                  />
                )}
              </article>
            );
          })}
    </section>
  );
}

function HiddenDiffPlaceholder({ info, onReveal }: { info: HiddenDiffInfo; onReveal: () => void }) {
  const hiddenFileKindText = formatHiddenFileKindLabels(info.presetLabels);
  return (
    <div className="hidden-diff-placeholder">
      <div className="hidden-diff-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="hidden-diff-message">
        <button className="hidden-diff-load" type="button" onClick={onReveal}>
          Load diff
        </button>
        <p>{hiddenFileKindText} are not rendered by default.</p>
      </div>
    </div>
  );
}

function formatHiddenFileKindLabels(labels: string[]): string {
  if (labels.length === 0) {
    return 'Files matching selected presets';
  }
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${lowercaseInitial(labels[1])}`;
  }
  return `${labels
    .slice(0, -1)
    .map((label, index) => (index === 0 ? label : lowercaseInitial(label)))
    .join(', ')}, and ${lowercaseInitial(labels[labels.length - 1])}`;
}

function lowercaseInitial(value: string): string {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
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
  contextSource,
  file,
  readOnly,
  reviewId,
  selectedSourcePeek,
  splitPanePercentage,
  turnId,
  viewMode,
  wrapLines,
  onSplitPaneChange,
  onSplitPanePreview,
  onSourcePeek
}: {
  contextSource?: DiffContextSource;
  file: DiffFile;
  readOnly: boolean;
  reviewId?: string;
  selectedSourcePeek: SourcePeekTrigger | null;
  splitPanePercentage: number;
  turnId?: string;
  viewMode: DiffViewMode;
  wrapLines: boolean;
  onSplitPaneChange: (percentage: number) => void;
  onSplitPanePreview: (percentage: number) => void;
  onSourcePeek: (trigger: SourcePeekTrigger) => void;
}) {
  const comments = useReviewStore((state) => state.comments);
  const resolution = useReviewStore((state) => state.resolution);
  const draft = useReviewStore((state) => state.draft);
  const setDraft = useReviewStore((state) => state.setDraft);
  const updateComment = useReviewStore((state) => state.updateComment);
  const removeComment = useReviewStore((state) => state.removeComment);
  const { resolvedTheme } = useTheme();
  const [dragStart, setDragStart] = useState<RowRef | null>(null);
  const [dragEnd, setDragEnd] = useState<RowRef | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [editingComment, setEditingComment] = useState<{ id: string; body: string } | null>(null);
  const [highlightedFile, setHighlightedFile] = useState<{
    file: DiffFile;
    lines: HighlightedDiffLines | null;
    theme: typeof resolvedTheme;
  } | null>(null);
  const [contextByGap, setContextByGap] = useState<DiffContextStateByGap>({});
  const selectionRef = useRef<SelectionRef | null>(null);
  const cleanupSelectionListeners = useRef<(() => void) | null>(null);
  const editCommentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const contextGaps = useMemo(() => buildContextGaps(file), [file]);
  const contextGapByHunkIndex = useMemo(
    () => new Map(contextGaps.map((gap) => [gap.beforeHunkIndex, gap])),
    [contextGaps]
  );
  const expandedFile = useMemo(
    () => fileWithExpandedContext(file, contextByGap),
    [contextByGap, file]
  );
  const highlightedLines =
    highlightedFile?.file === expandedFile && highlightedFile.theme === resolvedTheme
      ? highlightedFile.lines
      : null;
  const visibleLines = useMemo(() => visibleDiffLines(file, contextByGap), [contextByGap, file]);
  const visualIndexByLine = useMemo(
    () => buildDiffVisualIndex(visibleLines, viewMode),
    [viewMode, visibleLines]
  );
  const resolvedByCommentId = useMemo(
    () => new Map((resolution?.comments ?? []).map((comment) => [comment.commentId, comment])),
    [resolution]
  );

  const fileComments = comments.filter(
    (comment): comment is LineComment => isLineComment(comment) && comment.filePath === file.path
  );
  const editingCommentId = editingComment?.id ?? null;
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
      diffSnippetForRange(visibleLines, row.side, startLine, endLine, viewMode) || row.snippet;
    setDraftBody('');
    setDraft({
      filePath: file.path,
      side: row.side,
      startLine,
      endLine,
      originalSnippet: snippet
    });
  };
  const saveEditedComment = () => {
    if (!editingComment || editingComment.body.trim().length === 0) {
      return;
    }
    updateComment(editingComment.id, editingComment.body);
    setEditingComment(null);
  };

  useEffect(() => () => cleanupSelectionListeners.current?.(), []);
  useEffect(() => {
    if (editingCommentId) {
      editCommentTextareaRef.current?.focus({ preventScroll: true });
    }
  }, [editingCommentId]);

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

  const expandContext = async (gap: DiffContextGap, direction: ContextExpansionDirection) => {
    if (!reviewId || !contextSource) {
      return;
    }

    const requestWindow = contextExpansionRequest(gap, contextByGap[gap.id], direction);
    if (!requestWindow) {
      return;
    }

    setContextByGap((current) => ({
      ...current,
      [gap.id]: {
        lines: current[gap.id]?.lines ?? [],
        loading: true,
        error: null
      }
    }));

    try {
      const response = await fetchDiffContext({
        reviewId,
        filePath: gap.filePath,
        oldPath: gap.oldPath,
        turnId,
        source: contextSource,
        ...requestWindow
      });
      setContextByGap((current) => ({
        ...current,
        [gap.id]: mergeContextLines(gap, current[gap.id], response.lines)
      }));
    } catch (reason) {
      setContextByGap((current) => ({
        ...current,
        [gap.id]: {
          lines: current[gap.id]?.lines ?? [],
          loading: false,
          error: reason instanceof Error ? reason.message : String(reason)
        }
      }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    import('../syntax')
      .then(({ highlightDiffFile }) => highlightDiffFile(expandedFile, resolvedTheme))
      .then((nextHighlightedLines) => {
        if (!cancelled) {
          setHighlightedFile({
            file: expandedFile,
            lines: nextHighlightedLines,
            theme: resolvedTheme
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedFile({
            file: expandedFile,
            lines: null,
            theme: resolvedTheme
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [expandedFile, resolvedTheme]);

  const renderDiffLine = (line: DiffLine, keyPrefix: string, explicitSide?: Side) => {
    const side = explicitSide ?? diffLineSide(line);
    const lineNumber = diffLineNumberForSide(line, side);
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
    const activeDragSelection =
      (viewMode === 'unified' || dragStart?.side === side) &&
      visualIndex != null &&
      dragVisualRange &&
      isInVisualRange(visualIndex, dragVisualRange)
        ? { index: visualIndex, range: dragVisualRange }
        : null;
    const draftLineNumber =
      draft && (!explicitSide || draft.side === side)
        ? diffLineNumberForSide(line, draft.side)
        : null;
    const draftVisualIndex =
      viewMode === 'unified'
        ? visualIndex
        : draft && draftLineNumber != null
          ? visualIndexByLine.get(diffLineKey(draft.side, draftLineNumber))
          : null;
    const activeDraftSelection =
      draftVisualIndex != null &&
      draftVisualRange &&
      isInVisualRange(draftVisualIndex, draftVisualRange)
        ? { index: draftVisualIndex, range: draftVisualRange }
        : null;
    const activeSelection = activeDragSelection ?? activeDraftSelection;
    const selectionClass =
      activeSelection != null
        ? selectionClassForLine(
            activeSelection.index,
            activeSelection.range.start,
            activeSelection.range.end
          )
        : '';
    const showDraftComposer =
      draft && draft.filePath === file.path && draftLineNumber === draft.endLine;
    const rowComments = fileComments.filter((comment) => {
      if (explicitSide && comment.side !== side) {
        return false;
      }
      return (
        diffLineNumberForSide(line, comment.side) === Math.max(comment.startLine, comment.endLine)
      );
    });
    return (
      <div
        className={explicitSide ? 'split-diff-cell' : undefined}
        key={`${keyPrefix}:${line.type}:${line.oldLine ?? 'x'}:${line.newLine ?? 'x'}:${line.content}`}
      >
        {explicitSide ? (
          <span className="sr-only">{side === 'L' ? 'Old version' : 'New version'}</span>
        ) : null}
        <div
          className={`diff-row ${line.type} ${readOnly ? 'read-only' : ''} ${selectionClass} ${showDraftComposer ? 'range-continues' : ''}`}
          data-file-path={file.path}
          data-line={lineNumber}
          data-side={side}
        >
          {selectionClass ? <span className="selection-rail" aria-hidden="true" /> : null}
          <div className="diff-gutter">
            {explicitSide ? (
              <span className={`line-number ${side === 'L' ? 'old' : 'new'}`}>{lineNumber}</span>
            ) : (
              <>
                <span className="line-number old">{line.oldLine ?? ''}</span>
                <span className="line-number new">{line.newLine ?? ''}</span>
              </>
            )}
            <span className="marker">{diffLineMarker(line)}</span>
            {!readOnly ? (
              <button
                aria-label={`Comment on ${file.path}${
                  explicitSide ? ` ${side === 'L' ? 'old' : 'new'}` : ''
                } line ${lineNumber}`}
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
            selectedSourcePeek={
              selectedSourcePeek &&
              selectedSourcePeek.filePath === file.path &&
              selectedSourcePeek.oldPath === file.oldPath &&
              selectedSourcePeek.side === side &&
              selectedSourcePeek.line === lineNumber
                ? selectedSourcePeek
                : null
            }
            tokens={highlightedLines?.get(diffLineKey(side, lineNumber)) ?? null}
            onSourcePeek={(symbol, column) =>
              onSourcePeek({
                column,
                filePath: file.path,
                line: lineNumber,
                oldPath: file.oldPath,
                side,
                symbol
              })
            }
          />
        </div>
        {rowComments.map((comment) => {
          const resolvedComment = resolvedByCommentId.get(comment.id);
          const isEditing = editingComment?.id === comment.id;
          return (
            <div
              className={`inline-comment ${resolvedComment ? 'resolved' : 'open'} ${isEditing ? 'editing' : ''}`}
              data-comment-id={comment.id}
              key={comment.id}
            >
              {resolvedComment ? <CheckCircle2 size={14} /> : <MessageSquare size={14} />}
              <div className="inline-comment-content">
                {readOnly ? (
                  <span className="inline-comment-status">
                    {resolvedComment ? 'Resolved' : 'Open · Needs fix'}
                  </span>
                ) : null}
                {isEditing ? (
                  <form
                    className="inline-comment-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveEditedComment();
                    }}
                  >
                    <textarea
                      aria-label="Edit comment"
                      ref={editCommentTextareaRef}
                      value={editingComment.body}
                      onChange={(event) =>
                        setEditingComment({ id: comment.id, body: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingComment(null);
                        } else if (isSubmitCommentShortcut(event)) {
                          event.preventDefault();
                          saveEditedComment();
                        }
                      }}
                    />
                    <div className="inline-comment-edit-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setEditingComment(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="primary-button"
                        type="submit"
                        disabled={editingComment.body.trim().length === 0}
                      >
                        <Check size={14} />
                        Save
                      </button>
                    </div>
                  </form>
                ) : (
                  <span className="inline-comment-body">{comment.body}</span>
                )}
                {resolvedComment?.summary ? (
                  <span className="inline-comment-summary">{resolvedComment.summary}</span>
                ) : null}
              </div>
              {!readOnly && !isEditing ? (
                <div className="inline-comment-actions">
                  <button
                    aria-label="Edit comment"
                    className="inline-comment-action-button"
                    title="Edit comment"
                    type="button"
                    onClick={() => setEditingComment({ id: comment.id, body: comment.body })}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    aria-label="Delete comment"
                    className="inline-comment-action-button"
                    title="Delete comment"
                    type="button"
                    onClick={() => removeComment(comment.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {showDraftComposer && !readOnly ? (
          <CommentComposer body={draftBody} tone={line.type} onBodyChange={setDraftBody} />
        ) : null}
      </div>
    );
  };

  const renderDiffLines = (lines: DiffLine[], keyPrefix: string) => {
    if (viewMode === 'unified') {
      return lines.map((line) => renderDiffLine(line, keyPrefix));
    }

    const rows = splitDiffLines(lines);
    if (rows.length === 0) {
      return null;
    }

    const paneStyle = { gridRow: `1 / span ${rows.length}` };
    return (
      <div className="split-diff-block" key={`${keyPrefix}:split`}>
        <div className="split-diff-pane split-diff-pane-left" style={paneStyle}>
          {rows.map((row, index) => {
            const key = `${keyPrefix}:left:${index}:${row.left?.oldLine ?? 'x'}`;
            return row.left ? (
              renderDiffLine(row.left, key, 'L')
            ) : (
              <div className="split-diff-cell split-diff-empty" key={key}>
                <span className="sr-only">Old version, no line</span>
              </div>
            );
          })}
        </div>
        <div className="split-diff-pane split-diff-pane-right" style={paneStyle}>
          {rows.map((row, index) => {
            const key = `${keyPrefix}:right:${index}:${row.right?.newLine ?? 'x'}`;
            return row.right ? (
              renderDiffLine(row.right, key, 'R')
            ) : (
              <div className="split-diff-cell split-diff-empty" key={key}>
                <span className="sr-only">New version, no line</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderContextGap = (gap: DiffContextGap) =>
    expandedContextSegments(gap, contextByGap[gap.id]).map((segment, segmentIndex) => {
      if (segment.type === 'lines') {
        return renderDiffLines(segment.lines, `context:${gap.id}:${segmentIndex}`);
      }
      return (
        <HiddenLinesControl
          canExpand={Boolean(reviewId && contextSource)}
          directions={contextExpansionDirectionsForSegment(gap, segment)}
          error={contextByGap[gap.id]?.error ?? null}
          key={`hidden:${gap.id}:${segment.oldStart}:${segment.newStart}:${segment.lineCount}`}
          loading={contextByGap[gap.id]?.loading ?? false}
          segment={segment}
          onExpand={(direction) => {
            void expandContext(gap, direction);
          }}
        />
      );
    });

  const showSplitPanes =
    viewMode === 'split' && hasResizableSplitContent(file.isBinary, file.hunks.length);

  return (
    <section
      aria-label={`${file.path} diff`}
      className={`diff-scroller ${viewMode === 'split' ? 'split-mode' : ''} ${
        wrapLines ? 'wrap-lines' : ''
      }`}
      key={wrapLines ? 'wrapped' : 'unwrapped'}
    >
      <div
        className={`diff-table ${showSplitPanes ? 'split-view' : ''} ${
          dragStart ? 'selecting' : ''
        }`}
      >
        {showSplitPanes ? (
          <SplitDiffDivider
            percentage={splitPanePercentage}
            onChange={onSplitPaneChange}
            onPreview={onSplitPanePreview}
          />
        ) : null}
        {file.isBinary ? <div className="binary-note">Binary file changed</div> : null}
        {file.hunks.map((hunk, hunkIndex) => {
          const gap = contextGapByHunkIndex.get(hunkIndex);
          const header = hunkHeaderForVisibleLines(
            hunk,
            expandedFile.hunks[hunkIndex]?.lines ?? hunk.lines
          );
          return (
            <div className="hunk" key={`${hunk.oldStart}:${hunk.newStart}`}>
              {gap ? renderContextGap(gap) : null}
              {header ? <div className="hunk-header">{header}</div> : null}
              {renderDiffLines(hunk.lines, `hunk:${hunkIndex}`)}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SplitDiffDivider({
  percentage,
  onChange,
  onPreview
}: {
  percentage: number;
  onChange: (percentage: number) => void;
  onPreview: (percentage: number) => void;
}) {
  const cleanupResizeRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupResizeRef.current?.(), []);

  const startResize = (event: React.PointerEvent<HTMLHRElement>) => {
    if (event.button !== 0) {
      return;
    }
    const table = event.currentTarget.closest<HTMLElement>('.diff-table');
    if (!table) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    cleanupResizeRef.current?.();

    const handle = event.currentTarget;
    const bounds = table.getBoundingClientRect();
    const pointerId = event.pointerId;
    let nextPercentage = percentage;
    let moved = false;

    const updateFromPointer = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      moveEvent.preventDefault();
      moved = true;
      nextPercentage = splitPanePercentageForPointer(
        moveEvent.clientX,
        bounds.left,
        bounds.width,
        nextPercentage
      );
      handle.setAttribute('aria-valuenow', String(Math.round(nextPercentage)));
      handle.setAttribute('aria-valuetext', splitPaneValueText(nextPercentage));
      onPreview(nextPercentage);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', updateFromPointer);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', cancelResize);
      window.removeEventListener('blur', cancelResize);
      document.body.classList.remove('split-diff-resizing');
      delete handle.dataset.resizing;
      cleanupResizeRef.current = null;
    };
    const finishResize = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      if (moved) {
        updateFromPointer(upEvent);
      }
      cleanup();
      onChange(nextPercentage);
    };
    const cancelResize = () => {
      cleanup();
      onChange(nextPercentage);
    };

    handle.dataset.resizing = 'true';
    document.body.classList.add('split-diff-resizing');
    cleanupResizeRef.current = cleanup;
    window.addEventListener('pointermove', updateFromPointer);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', cancelResize);
    window.addEventListener('blur', cancelResize, { once: true });
  };

  return (
    <hr
      aria-label="Resize old and new diff panes"
      aria-orientation="vertical"
      aria-valuemax={MAX_SPLIT_PANE_PERCENTAGE}
      aria-valuemin={MIN_SPLIT_PANE_PERCENTAGE}
      aria-valuenow={Math.round(percentage)}
      aria-valuetext={splitPaneValueText(percentage)}
      className="split-diff-resize-handle"
      tabIndex={0}
      title="Resize old and new diff panes"
      onKeyDown={(event) => {
        const nextPercentage = splitPanePercentageForKey(percentage, event.key);
        if (nextPercentage == null) {
          return;
        }
        event.preventDefault();
        onChange(nextPercentage);
      }}
      onPointerDown={startResize}
    />
  );
}

function splitPaneValueText(percentage: number): string {
  const roundedPercentage = Math.round(percentage);
  return `${roundedPercentage}% old, ${100 - roundedPercentage}% new`;
}

function HiddenLinesControl({
  canExpand,
  directions,
  error,
  loading,
  segment,
  onExpand
}: {
  canExpand: boolean;
  directions: ContextExpansionDirection[];
  error: string | null;
  loading: boolean;
  segment: Extract<DiffContextSegment, { type: 'hidden' }>;
  onExpand: (direction: ContextExpansionDirection) => void;
}) {
  const disabled = !canExpand || Boolean(loading);
  return (
    <div className="hidden-lines">
      <div className="hidden-lines-main">
        <span className="hidden-lines-count">
          {loading ? (
            <>
              <LoaderCircle className="spin" size={14} />
              Loading context
            </>
          ) : (
            `${segment.lineCount} unmodified ${segment.lineCount === 1 ? 'line' : 'lines'}`
          )}
        </span>
        <div className="hidden-lines-actions">
          {directions.map((direction) => {
            const label = hiddenContextLabel(direction);
            return (
              <button
                aria-label={label}
                className="hidden-lines-action"
                disabled={disabled}
                key={direction}
                title={label}
                type="button"
                onClick={() => onExpand(direction)}
              >
                <HiddenContextIcon direction={direction} directions={directions} />
              </button>
            );
          })}
        </div>
      </div>
      {error ? <div className="hidden-lines-error">{error}</div> : null}
    </div>
  );
}

function hiddenContextLabel(direction: ContextExpansionDirection): string {
  if (direction === 'up') {
    return 'Expand hidden context upward';
  }
  if (direction === 'down') {
    return 'Expand hidden context downward';
  }
  return 'Expand more hidden context';
}

function HiddenContextIcon({
  direction,
  directions
}: {
  direction: ContextExpansionDirection;
  directions: ContextExpansionDirection[];
}) {
  if (direction === 'up') {
    return <ChevronUp size={15} />;
  }
  if (direction === 'down') {
    return <ChevronDown size={15} />;
  }
  if (directions.length === 2 && directions[0] === 'up') {
    return <ChevronsUp size={15} />;
  }
  if (directions.length === 2 && directions[0] === 'down') {
    return <ChevronsDown size={15} />;
  }
  return <ChevronsUpDown size={15} />;
}

function CodeLine({
  content,
  selectedSourcePeek,
  tokens,
  onSourcePeek
}: {
  content: string;
  selectedSourcePeek: SourcePeekTrigger | null;
  tokens: SyntaxToken[] | null;
  onSourcePeek: (symbol: string, column: number) => void;
}) {
  if (!tokens || tokens.length === 0) {
    return (
      <code>
        <SourcePeekText
          offsetBase={0}
          selectedSourcePeek={selectedSourcePeek}
          text={content || ' '}
          onSourcePeek={onSourcePeek}
        />
      </code>
    );
  }

  return (
    <code>
      {tokens.map((token) => {
        const style = styleForToken(token);
        return (
          <span key={`${token.offset}:${token.content}`} style={style}>
            <SourcePeekText
              offsetBase={token.offset}
              selectedSourcePeek={selectedSourcePeek}
              style={style}
              text={token.content}
              onSourcePeek={onSourcePeek}
            />
          </span>
        );
      })}
    </code>
  );
}

const identifierRegex = /[A-Za-z_$][\w$]*/g;
const syntaxKeywords = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield'
]);

function SourcePeekText({
  offsetBase,
  selectedSourcePeek,
  style,
  text,
  onSourcePeek
}: {
  offsetBase: number;
  selectedSourcePeek: SourcePeekTrigger | null;
  style?: CSSProperties;
  text: string;
  onSourcePeek: (symbol: string, column: number) => void;
}) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  identifierRegex.lastIndex = 0;
  let match = identifierRegex.exec(text);
  while (match !== null) {
    const identifier = match[0];
    const matchIndex = match.index;
    if (matchIndex > cursor) {
      nodes.push(text.slice(cursor, matchIndex));
    }
    if (syntaxKeywords.has(identifier)) {
      nodes.push(identifier);
    } else {
      const column = offsetBase + matchIndex;
      const selected =
        selectedSourcePeek?.column === column && selectedSourcePeek.symbol === identifier;
      nodes.push(
        <button
          aria-current={selected ? 'location' : undefined}
          className={`source-symbol ${selected ? 'selected' : ''}`}
          data-source-symbol={identifier}
          key={`${offsetBase}:${matchIndex}:${identifier}`}
          style={style}
          tabIndex={-1}
          title="Command-click or Control-click to peek source"
          type="button"
          onClick={(event) => {
            if (!event.metaKey && !event.ctrlKey) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onSourcePeek(identifier, column);
          }}
          onMouseDown={(event) => {
            if (event.metaKey || event.ctrlKey) {
              event.preventDefault();
            }
          }}
          onContextMenu={(event) => {
            if (!event.metaKey && !event.ctrlKey) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onSourcePeek(identifier, column);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onSourcePeek(identifier, column);
          }}
        >
          {identifier}
        </button>
      );
    }
    cursor = matchIndex + identifier.length;
    match = identifierRegex.exec(text);
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return <>{nodes.length > 0 ? nodes : text}</>;
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

function contextKey(
  reviewId: string | undefined,
  turnId: string | undefined,
  source: DiffContextSource | undefined
): string {
  if (!reviewId || !source) {
    return '';
  }
  if (source.mode === 'turn') {
    return `${reviewId}:${turnId ?? ''}:turn`;
  }
  if (source.mode === 'commit') {
    return `${reviewId}:${turnId ?? ''}:commit:${source.sha}`;
  }
  return `${reviewId}:${turnId ?? ''}:range:${source.fromSha}:${source.toSha}`;
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
