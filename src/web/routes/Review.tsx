import {
  Check,
  CheckCircle2,
  ChevronDown,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  MoveHorizontal,
  PanelLeftOpen,
  WrapText,
  X
} from 'lucide-react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { reviewResolutionCounts } from '../../shared/comments';
import { reviewDisplayTitle } from '../../shared/review-title';
import { isResolvableReviewStatus } from '../../shared/reviews';
import type {
  CommitDiff,
  CommitRangeDiffResponse,
  DiffPayload,
  ReviewRecord
} from '../../shared/types';
import { isReviewEvent, parseJson } from '../../shared/validation';
import { fetchCommitRangeDiff, fetchReview, openReviewFile } from '../api';
import { DiffView, fileCardElementId } from '../components/DiffView';
import { buildExtensionBuckets, FileTree, filterDiffFiles } from '../components/FileTree';
import { SubmitBar } from '../components/SubmitBar';
import { useReviewStore } from '../store';
import { loadViewedFiles, saveViewedFiles } from '../viewed-files';

export interface FileFilterState {
  extensionIds: string[];
  reviewId: string | null;
  searchQuery: string;
  selectedExtensionIds: Set<string>;
}

type CommitView =
  | { mode: 'all' }
  | { mode: 'single'; sha: string }
  | { mode: 'range'; fromSha: string; toSha: string };

const FILE_TREE_MIN_WIDTH = 300;
const FILE_TREE_MAX_WIDTH = 560;
const FILE_TREE_DEFAULT_WIDTH = 360;
const EMPTY_DIFF: Pick<DiffPayload, 'files' | 'stats'> = {
  files: [],
  stats: { files: 0, additions: 0, deletions: 0 }
};

export function Review({ reviewId }: { reviewId: string }) {
  const [record, setRecord] = useState<ReviewRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrapLines, setWrapLines] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileTreeCollapsed, setFileTreeCollapsed] = useState(true);
  const [fileTreeDrawerOpen, setFileTreeDrawerOpen] = useState(false);
  const [fileTreeWidth, setFileTreeWidth] = useState(FILE_TREE_DEFAULT_WIDTH);
  const [filterState, setFilterState] = useState<FileFilterState>({
    extensionIds: [],
    reviewId: null,
    searchQuery: '',
    selectedExtensionIds: new Set()
  });
  const [commitView, setCommitView] = useState<CommitView>({ mode: 'all' });
  const [rangeDiff, setRangeDiff] = useState<CommitRangeDiffResponse | null>(null);
  const [rangeDiffError, setRangeDiffError] = useState<string | null>(null);
  const [rangeDiffLoading, setRangeDiffLoading] = useState(false);
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set());
  const [openFileError, setOpenFileError] = useState<string | null>(null);
  const reset = useReviewStore((state) => state.reset);
  const hydrateReview = useReviewStore((state) => state.hydrateReview);
  const setDraft = useReviewStore((state) => state.setDraft);
  const displayTitle = record ? reviewDisplayTitle(record) : null;
  const selectedCommitDiff =
    record && commitView.mode === 'single'
      ? (record.diff.commitDiffs?.find((commitDiff) => commitDiff.commit.sha === commitView.sha) ??
        null)
      : null;
  const selectedRangeDiff =
    record && commitView.mode === 'range' ? (rangeDiff ?? EMPTY_DIFF) : null;
  const activeDiff: Pick<DiffPayload, 'files' | 'stats'> | null = record
    ? (selectedRangeDiff ?? selectedCommitDiff ?? record.diff)
    : null;
  const reviewFiles = activeDiff?.files ?? [];
  const extensionBuckets = useMemo(() => buildExtensionBuckets(reviewFiles), [reviewFiles]);
  const extensionIds = useMemo(
    () => extensionBuckets.map((bucket) => bucket.id),
    [extensionBuckets]
  );
  const recordId = record?.meta.id ?? null;
  const filtersMatchRecord = Boolean(record && filterState.reviewId === record.meta.id);
  const selectedExtensionIds = useMemo(
    () => (filtersMatchRecord ? filterState.selectedExtensionIds : new Set(extensionIds)),
    [extensionIds, filterState.selectedExtensionIds, filtersMatchRecord]
  );
  const searchQuery = filtersMatchRecord ? filterState.searchQuery : '';
  const filteredFiles = useMemo(
    () => filterDiffFiles(reviewFiles, searchQuery, selectedExtensionIds),
    [reviewFiles, searchQuery, selectedExtensionIds]
  );

  const applyRecord = useCallback(
    (nextRecord: ReviewRecord) => {
      setRecord(nextRecord);
      hydrateReview(nextRecord.feedback?.comments ?? [], nextRecord.resolution ?? null);
    },
    [hydrateReview]
  );

  const reloadReview = useCallback(async () => {
    const nextRecord = await fetchReview(reviewId);
    applyRecord(nextRecord);
  }, [reviewId, applyRecord]);

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setError(null);
    setActiveFilePath(null);
    setFileTreeCollapsed(true);
    setFileTreeDrawerOpen(false);
    setCommitView({ mode: 'all' });
    setRangeDiff(null);
    setRangeDiffError(null);
    setRangeDiffLoading(false);
    setViewedFiles(loadViewedFiles(reviewId));
    setOpenFileError(null);
    reset();
    fetchReview(reviewId)
      .then((nextRecord) => {
        if (cancelled) {
          return;
        }
        applyRecord(nextRecord);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId, reset, applyRecord]);

  useEffect(() => {
    if (!record) {
      return;
    }
    const commitDiffs = record.diff.commitDiffs ?? [];
    if (commitView.mode === 'single') {
      if (!commitDiffs.some((commitDiff) => commitDiff.commit.sha === commitView.sha)) {
        setCommitView({ mode: 'all' });
      }
      return;
    }
    if (commitView.mode === 'range') {
      const fromIndex = commitDiffs.findIndex(
        (commitDiff) => commitDiff.commit.sha === commitView.fromSha
      );
      const toIndex = commitDiffs.findIndex(
        (commitDiff) => commitDiff.commit.sha === commitView.toSha
      );
      if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) {
        setCommitView({ mode: 'all' });
      }
    }
  }, [record, commitView]);

  useEffect(() => {
    if (!record || commitView.mode !== 'range') {
      setRangeDiff(null);
      setRangeDiffError(null);
      setRangeDiffLoading(false);
      return;
    }

    let cancelled = false;
    setRangeDiff(null);
    setRangeDiffError(null);
    setRangeDiffLoading(true);
    fetchCommitRangeDiff(reviewId, commitView.fromSha, commitView.toSha)
      .then((nextRangeDiff) => {
        if (!cancelled) {
          setRangeDiff(nextRangeDiff);
          setRangeDiffLoading(false);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setRangeDiff(null);
          setRangeDiffLoading(false);
          setRangeDiffError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [commitView, record, reviewId]);

  useEffect(() => {
    const events = new EventSource(`/api/reviews/${reviewId}/events`);
    events.onmessage = (message) => {
      const event = parseJson(message.data, isReviewEvent, 'review event');
      if (event.type === 'review.submitted' || event.type === 'review.updated') {
        reloadReview().catch((reason) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        });
      }
    };

    return () => {
      events.close();
    };
  }, [reviewId, reloadReview]);

  useEffect(() => {
    if (displayTitle) {
      document.title = displayTitle;
    }
  }, [displayTitle]);

  useEffect(() => {
    if (!recordId) {
      return;
    }
    setFilterState((current) => syncFileFilterState(current, recordId, extensionIds));
  }, [extensionIds, recordId]);

  useEffect(() => {
    if (!activeFilePath) {
      return;
    }
    if (!filteredFiles.some((file) => file.path === activeFilePath)) {
      setActiveFilePath(null);
    }
  }, [activeFilePath, filteredFiles]);

  if (error) {
    return (
      <main className="empty-shell">
        <section className="empty-panel">
          <h1>Review unavailable</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (!record || !activeDiff || !displayTitle) {
    return (
      <main className="empty-shell">
        <section className="empty-panel">
          <LoaderCircle className="spin" size={24} />
          <p>Loading review</p>
        </section>
      </main>
    );
  }

  const scope = record.diff.scope;
  const stats = activeDiff.stats;
  const readOnly = isResolvableReviewStatus(record.meta.status);
  const viewedCount = activeDiff.files.filter((file) => viewedFiles.has(file.path)).length;
  const viewedProgress =
    activeDiff.files.length === 0 ? 0 : Math.round((viewedCount / activeDiff.files.length) * 100);
  const updateSearchQuery = (searchQuery: string) => {
    setFilterState((current) => ({
      extensionIds,
      reviewId: record.meta.id,
      searchQuery,
      selectedExtensionIds:
        current.reviewId === record.meta.id ? current.selectedExtensionIds : new Set(extensionIds)
    }));
  };
  const toggleExtension = (extensionId: string) => {
    setFilterState((current) => {
      const selectedExtensionIds =
        current.reviewId === record.meta.id
          ? new Set(current.selectedExtensionIds)
          : new Set(extensionIds);
      selectedExtensionIds.has(extensionId)
        ? selectedExtensionIds.delete(extensionId)
        : selectedExtensionIds.add(extensionId);
      return {
        extensionIds,
        reviewId: record.meta.id,
        searchQuery: current.reviewId === record.meta.id ? current.searchQuery : '',
        selectedExtensionIds
      };
    });
  };
  const selectAllExtensions = () => {
    setFilterState((current) => ({
      extensionIds,
      reviewId: record.meta.id,
      searchQuery: current.reviewId === record.meta.id ? current.searchQuery : '',
      selectedExtensionIds: new Set(extensionIds)
    }));
  };
  const clearExtensions = () => {
    setFilterState((current) => ({
      extensionIds,
      reviewId: record.meta.id,
      searchQuery: current.reviewId === record.meta.id ? current.searchQuery : '',
      selectedExtensionIds: new Set()
    }));
  };
  const scrollToFile = (filePath: string) => {
    const target = document.getElementById(fileCardElementId(filePath));
    if (!target) {
      return;
    }
    const headerOffset = 156;
    const targetTop = target.getBoundingClientRect().top + window.scrollY - headerOffset;
    window.scrollTo({
      behavior: 'smooth',
      top: Math.max(targetTop, 0)
    });
  };
  const selectFile = (filePath: string) => {
    setActiveFilePath(filePath);
    setFileTreeDrawerOpen(false);
    window.requestAnimationFrame(() => {
      window.setTimeout(() => scrollToFile(filePath), 0);
    });
  };
  const startFileTreeResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = fileTreeWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      setFileTreeWidth(Math.min(FILE_TREE_MAX_WIDTH, Math.max(FILE_TREE_MIN_WIDTH, nextWidth)));
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };
  const handleViewedChange = (filePath: string, viewed: boolean) => {
    setViewedFiles((current) => {
      const next = new Set(current);
      viewed ? next.add(filePath) : next.delete(filePath);
      saveViewedFiles(reviewId, next);
      return next;
    });
  };
  const handleOpenFile = async (filePath: string) => {
    setOpenFileError(null);
    try {
      await openReviewFile(reviewId, filePath);
    } catch (reason) {
      setOpenFileError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const renderFileTree = () => (
    <FileTree
      activeFilePath={activeFilePath}
      extensionBuckets={extensionBuckets}
      files={activeDiff.files}
      filteredFiles={filteredFiles}
      searchQuery={searchQuery}
      selectedExtensionIds={selectedExtensionIds}
      onCollapse={() => setFileTreeCollapsed(true)}
      onClearExtensions={clearExtensions}
      onFileSelect={selectFile}
      onSearchChange={updateSearchQuery}
      onSelectAllExtensions={selectAllExtensions}
      onToggleExtension={toggleExtension}
    />
  );
  const drawerFileTree = (
    <FileTree
      activeFilePath={activeFilePath}
      extensionBuckets={extensionBuckets}
      files={activeDiff.files}
      filteredFiles={filteredFiles}
      searchQuery={searchQuery}
      selectedExtensionIds={selectedExtensionIds}
      onClearExtensions={clearExtensions}
      onFileSelect={selectFile}
      onSearchChange={updateSearchQuery}
      onSelectAllExtensions={selectAllExtensions}
      onToggleExtension={toggleExtension}
    />
  );
  const filteredEmptyState =
    activeDiff.files.length === 0 ? null : (
      <div className="empty-diff filtered-empty">
        <h2>No matching files</h2>
        <p>Adjust the file search or extension filters to show changed files.</p>
      </div>
    );

  return (
    <main className="review-shell">
      <header className="topbar">
        <div className="topbar-header">
          <div className="topbar-title">
            <img className="brand-mark" src="/logo.svg" alt="" />
            <div className="review-heading">
              <p className="product-name">Gloss</p>
              <h1>{displayTitle}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <CommitSelector
              commitDiffs={record.diff.commitDiffs ?? []}
              value={commitView}
              onChange={(nextCommitView) => {
                setCommitView(nextCommitView);
                setDraft(null);
              }}
            />
            <div className="viewed-progress" title="Viewed files">
              <span
                aria-hidden="true"
                className="viewed-progress-ring"
                style={{ '--viewed-progress': `${viewedProgress}%` } as CSSProperties}
              />
              {viewedCount} / {activeDiff.files.length} viewed
            </div>
            <button
              aria-label="Open file tree"
              className="icon-button file-tree-mobile-toggle"
              title="Open file tree"
              type="button"
              onClick={() => setFileTreeDrawerOpen(true)}
            >
              <FileCode2 size={16} />
            </button>
            <button
              aria-label={wrapLines ? 'Unwrap lines' : 'Wrap lines'}
              aria-pressed={wrapLines}
              className="icon-button wrap-toggle"
              title={wrapLines ? 'Unwrap lines' : 'Wrap lines'}
              type="button"
              onClick={() => setWrapLines((current) => !current)}
            >
              {wrapLines ? <MoveHorizontal size={16} /> : <WrapText size={16} />}
            </button>
            <div className="branch-pill" title={record.meta.branch ?? 'Detached HEAD'}>
              <GitBranch size={16} />
              <span>{record.meta.branch ?? 'detached'}</span>
            </div>
          </div>
        </div>
        <div className="review-summary">
          <ReviewRefSummary label="Base" refName={scope.base.ref} sha={scope.base.sha} />
          <ReviewRefSummary
            label="Compare"
            refName={scope.comparison.ref}
            sha={scope.comparison.sha}
          />
          <div className="review-summary-card review-summary-stats">
            <span className="review-summary-label">Changes</span>
            <span className="review-summary-main">
              <span>
                {stats.files} {stats.files === 1 ? 'file' : 'files'}
              </span>
              <span className="summary-add">+{stats.additions}</span>
              <span className="summary-del">-{stats.deletions}</span>
            </span>
          </div>
        </div>
      </header>
      {openFileError ? <div className="open-file-message error">{openFileError}</div> : null}
      {rangeDiffError ? <div className="open-file-message error">{rangeDiffError}</div> : null}
      {rangeDiffLoading ? <div className="range-loading">Loading range diff</div> : null}
      {readOnly ? <ReviewStateBanner record={record} /> : null}
      <div
        className={`review-body ${fileTreeCollapsed ? 'file-tree-collapsed' : ''}`}
        style={{ '--file-tree-width': `${fileTreeWidth}px` } as CSSProperties}
      >
        <aside className={`review-sidebar ${fileTreeCollapsed ? 'collapsed' : ''}`}>
          {fileTreeCollapsed ? (
            <button
              aria-label="Expand file tree"
              className="file-tree-rail"
              title="Expand file tree"
              type="button"
              onClick={() => setFileTreeCollapsed(false)}
            >
              <PanelLeftOpen size={17} />
              <span>Files</span>
              <span>{filteredFiles.length}</span>
            </button>
          ) : (
            <>
              {renderFileTree()}
              <button
                aria-label="Resize file tree"
                className="file-tree-resize-handle"
                title="Resize file tree"
                type="button"
                onPointerDown={startFileTreeResize}
              />
            </>
          )}
        </aside>
        <section className="review-diff-column">
          <DiffView
            activeFilePath={activeFilePath}
            diff={activeDiff}
            emptyState={filteredEmptyState}
            files={filteredFiles}
            record={record}
            readOnly={readOnly}
            viewedFiles={viewedFiles}
            wrapLines={wrapLines}
            onOpenFile={handleOpenFile}
            onViewedChange={handleViewedChange}
          />
        </section>
      </div>
      {fileTreeDrawerOpen ? (
        <div className="file-tree-drawer-backdrop">
          <aside className="file-tree-drawer" role="dialog" aria-modal="true" aria-label="Files">
            <div className="file-tree-drawer-header">
              <span>Changed files</span>
              <button
                aria-label="Close file tree"
                className="icon-button"
                type="button"
                onClick={() => setFileTreeDrawerOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            {drawerFileTree}
          </aside>
        </div>
      ) : null}
      {readOnly ? null : <SubmitBar reviewId={reviewId} onSubmitted={reloadReview} />}
    </main>
  );
}

function ReviewRefSummary({
  label,
  refName,
  sha
}: {
  label: string;
  refName: string;
  sha: string | null;
}) {
  return (
    <div className="review-summary-card" title={`${label} ${refName}${sha ? ` (${sha})` : ''}`}>
      <span className="review-summary-label">{label}</span>
      <span className="review-summary-main">
        <span className="review-summary-ref">{refName}</span>
        {sha ? <span className="review-summary-sha">{sha.slice(0, 7)}</span> : null}
      </span>
    </div>
  );
}

function CommitSelector({
  commitDiffs,
  value,
  onChange
}: {
  commitDiffs: CommitDiff[];
  value: CommitView;
  onChange: (value: CommitView) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftMode, setDraftMode] = useState<'all' | 'selected'>('all');
  const [draftSelectedShas, setDraftSelectedShas] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const options = useMemo(
    () =>
      commitDiffs.map((commitDiff) => ({
        sha: commitDiff.commit.sha,
        shortSha: commitDiff.commit.shortSha,
        subject: commitDiff.commit.subject,
        authorName: commitDiff.commit.authorName,
        committedAt: commitDiff.commit.committedAt,
        fileCount: commitDiff.files.length
      })),
    [commitDiffs]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = [
      'button:not(:disabled)',
      'input:not(:disabled)',
      'select:not(:disabled)',
      'textarea:not(:disabled)',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const focusableElements = () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
        (element) => element.offsetParent !== null
      );
    window.requestAnimationFrame(() => {
      (focusableElements()[0] ?? dialogRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [isOpen]);

  if (options.length === 0) {
    return null;
  }

  const openPicker = () => {
    const selectedShas = shasForCommitView(value, options);
    setDraftMode(value.mode === 'all' || selectedShas.size === 0 ? 'all' : 'selected');
    setDraftSelectedShas(selectedShas);
    setIsOpen(true);
  };
  const selectedIndexes = selectedCommitIndexes(draftSelectedShas, options);
  const selectedRange =
    selectedIndexes.length > 0
      ? {
          from: options[selectedIndexes[0]],
          to: options[selectedIndexes[selectedIndexes.length - 1]],
          count: selectedIndexes[selectedIndexes.length - 1] - selectedIndexes[0] + 1
        }
      : null;
  const selectionSummary =
    draftMode === 'all'
      ? `${options.length} ${options.length === 1 ? 'commit' : 'commits'}`
      : selectedRange
        ? selectedRange.from.sha === selectedRange.to.sha
          ? selectedRange.from.shortSha
          : `${selectedRange.count} commits · ${selectedRange.from.shortSha} to ${
              selectedRange.to.shortSha
            }`
        : 'No commits selected';
  const canSave = draftMode === 'all' || selectedIndexes.length > 0;

  return (
    <div className="commit-selector">
      <button
        aria-expanded={isOpen}
        className="commit-picker-trigger"
        type="button"
        onClick={openPicker}
      >
        <GitCommitHorizontal size={16} />
        <span className="commit-picker-trigger-text">{commitViewLabel(value, options)}</span>
        <ChevronDown size={16} />
      </button>
      {isOpen
        ? createPortal(
            <div className="commit-picker-backdrop">
              <section
                aria-labelledby="commit-picker-title"
                aria-modal="true"
                className="commit-picker-dialog"
                ref={dialogRef}
                role="dialog"
                tabIndex={-1}
              >
                <header className="commit-picker-header">
                  <h2 id="commit-picker-title">Select commits to view</h2>
                  <button
                    aria-label="Close commit picker"
                    className="icon-button commit-picker-close"
                    type="button"
                    onClick={() => setIsOpen(false)}
                  >
                    <X size={20} />
                  </button>
                </header>
                <div className="commit-picker-body">
                  <label className={`commit-picker-all ${draftMode === 'all' ? 'selected' : ''}`}>
                    <input
                      checked={draftMode === 'all'}
                      className="commit-picker-checkbox"
                      type="checkbox"
                      onChange={() => {
                        setDraftMode('all');
                        setDraftSelectedShas(new Set());
                      }}
                    />
                    <span className="commit-picker-all-copy">
                      <span>All commits</span>
                      <span>
                        {options.length} {options.length === 1 ? 'commit' : 'commits'}
                      </span>
                    </span>
                  </label>
                  <div className="commit-picker-section-label">Select a range of commits</div>
                  <div className="commit-picker-list">
                    {options.map((option) => {
                      const checked = draftMode === 'selected' && draftSelectedShas.has(option.sha);
                      return (
                        <label
                          className={`commit-picker-row ${checked ? 'selected' : ''}`}
                          key={option.sha}
                        >
                          <input
                            checked={checked}
                            className="commit-picker-checkbox"
                            type="checkbox"
                            onChange={() => {
                              setDraftMode('selected');
                              setDraftSelectedShas((current) =>
                                toggleCommitRangeSelection(current, option.sha, options)
                              );
                            }}
                          />
                          <span className="commit-picker-row-copy">
                            <span className="commit-picker-subject">{option.subject}</span>
                            <span className="commit-picker-meta">
                              {option.authorName} committed {formatRelativeTime(option.committedAt)}{' '}
                              · {option.fileCount} {option.fileCount === 1 ? 'file' : 'files'}
                            </span>
                          </span>
                          <span className="commit-picker-sha">{option.shortSha}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <footer className="commit-picker-footer">
                  <span className="commit-picker-summary">{selectionSummary}</span>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setIsOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary-button"
                    disabled={!canSave}
                    type="button"
                    onClick={() => {
                      if (draftMode === 'all') {
                        onChange({ mode: 'all' });
                        setIsOpen(false);
                        return;
                      }
                      const nextView = commitViewFromSelectedIndexes(selectedIndexes, options);
                      if (!nextView) {
                        return;
                      }
                      onChange(nextView);
                      setIsOpen(false);
                    }}
                  >
                    <Check size={16} />
                    Save
                  </button>
                </footer>
              </section>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

type CommitPickerOption = {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  committedAt: string;
  fileCount: number;
};

function shasForCommitView(value: CommitView, options: CommitPickerOption[]): Set<string> {
  if (value.mode === 'all') {
    return new Set();
  }
  if (value.mode === 'single') {
    return options.some((option) => option.sha === value.sha) ? new Set([value.sha]) : new Set();
  }

  const fromIndex = options.findIndex((option) => option.sha === value.fromSha);
  const toIndex = options.findIndex((option) => option.sha === value.toSha);
  if (fromIndex < 0 || toIndex < fromIndex) {
    return new Set();
  }
  return commitRangeSet(fromIndex, toIndex, options);
}

function selectedCommitIndexes(selectedShas: Set<string>, options: CommitPickerOption[]): number[] {
  return options
    .map((option, index) => (selectedShas.has(option.sha) ? index : -1))
    .filter((index) => index >= 0);
}

function toggleCommitRangeSelection(
  selectedShas: Set<string>,
  sha: string,
  options: CommitPickerOption[]
): Set<string> {
  const clickedIndex = options.findIndex((option) => option.sha === sha);
  if (clickedIndex < 0) {
    return selectedShas;
  }

  const selectedIndexes = selectedCommitIndexes(selectedShas, options);
  if (!selectedShas.has(sha)) {
    const fromIndex =
      selectedIndexes.length > 0 ? Math.min(selectedIndexes[0], clickedIndex) : clickedIndex;
    const toIndex =
      selectedIndexes.length > 0
        ? Math.max(selectedIndexes[selectedIndexes.length - 1], clickedIndex)
        : clickedIndex;
    return commitRangeSet(fromIndex, toIndex, options);
  }

  if (selectedIndexes.length <= 1) {
    return new Set();
  }

  const firstIndex = selectedIndexes[0];
  const lastIndex = selectedIndexes[selectedIndexes.length - 1];
  if (clickedIndex <= firstIndex) {
    return commitRangeSet(firstIndex + 1, lastIndex, options);
  }
  if (clickedIndex >= lastIndex) {
    return commitRangeSet(firstIndex, lastIndex - 1, options);
  }

  const leftCount = clickedIndex - firstIndex;
  const rightCount = lastIndex - clickedIndex;
  return leftCount >= rightCount
    ? commitRangeSet(firstIndex, clickedIndex - 1, options)
    : commitRangeSet(clickedIndex + 1, lastIndex, options);
}

function commitRangeSet(
  fromIndex: number,
  toIndex: number,
  options: CommitPickerOption[]
): Set<string> {
  if (fromIndex < 0 || toIndex < fromIndex) {
    return new Set();
  }
  return new Set(options.slice(fromIndex, toIndex + 1).map((option) => option.sha));
}

function commitViewFromSelectedIndexes(
  selectedIndexes: number[],
  options: CommitPickerOption[]
): CommitView | null {
  if (selectedIndexes.length === 0) {
    return null;
  }
  const fromIndex = selectedIndexes[0];
  const toIndex = selectedIndexes[selectedIndexes.length - 1];
  if (fromIndex === toIndex) {
    return { mode: 'single', sha: options[fromIndex].sha };
  }
  return {
    mode: 'range',
    fromSha: options[fromIndex].sha,
    toSha: options[toIndex].sha
  };
}

function commitViewLabel(value: CommitView, options: CommitPickerOption[]): string {
  if (value.mode === 'all') {
    return 'All commits';
  }
  if (value.mode === 'single') {
    const option = options.find((commitOption) => commitOption.sha === value.sha);
    return option ? `${option.shortSha} ${option.subject}` : 'One commit';
  }

  const fromIndex = options.findIndex((option) => option.sha === value.fromSha);
  const toIndex = options.findIndex((option) => option.sha === value.toSha);
  if (fromIndex < 0 || toIndex < fromIndex) {
    return 'Commit range';
  }
  const count = toIndex - fromIndex + 1;
  return `${count} commits · ${options[fromIndex].shortSha} to ${options[toIndex].shortSha}`;
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'recently';
  }
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1]
  ];
  const fallbackUnit = units[units.length - 1];
  if (!fallbackUnit) {
    return 'recently';
  }
  const [unit, secondsPerUnit] =
    units.find(([, unitSeconds]) => Math.abs(diffSeconds) >= unitSeconds) ?? fallbackUnit;
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
    Math.round(diffSeconds / secondsPerUnit),
    unit
  );
}

export function syncFileFilterState(
  current: FileFilterState,
  recordId: string,
  extensionIds: string[]
): FileFilterState {
  if (current.reviewId !== recordId) {
    return {
      extensionIds,
      reviewId: recordId,
      searchQuery: '',
      selectedExtensionIds: new Set(extensionIds)
    };
  }

  const previousAllSelected =
    current.selectedExtensionIds.size === current.extensionIds.length &&
    current.extensionIds.every((extensionId) => current.selectedExtensionIds.has(extensionId));
  const selectedExtensionIds = previousAllSelected
    ? new Set(extensionIds)
    : new Set(extensionIds.filter((extensionId) => current.selectedExtensionIds.has(extensionId)));

  return {
    extensionIds,
    reviewId: recordId,
    searchQuery: current.searchQuery,
    selectedExtensionIds
  };
}

function ReviewStateBanner({ record }: { record: ReviewRecord }) {
  const state = stateContent(record);
  if (!state) {
    return null;
  }
  const timestamp =
    record.meta.status === 'resolved'
      ? (record.meta.resolvedAt ?? record.resolution?.resolvedAt)
      : record.meta.submittedAt;

  return (
    <section className={`review-state-banner ${record.meta.status}`}>
      <div className="review-state-title">
        <CheckCircle2 size={16} />
        <span>{state.title}</span>
      </div>
      <p>{state.body}</p>
      {timestamp ? <time dateTime={timestamp}>{formatTimestamp(timestamp)}</time> : null}
    </section>
  );
}

function stateContent(record: ReviewRecord): { title: string; body: string } | null {
  const status = record.meta.status;
  const counts = reviewResolutionCounts(record);
  const progress =
    counts.total > 0 ? `${counts.resolved} of ${counts.total} comments resolved` : null;
  if (status === 'submitted') {
    return {
      title: counts.resolved > 0 && progress ? `Submitted · ${progress}` : 'Submitted',
      body:
        counts.resolved > 0
          ? 'Feedback is being handled. Start a fresh Gloss review for the next diff.'
          : 'Feedback has been submitted. Start a fresh Gloss review for the next diff.'
    };
  }
  if (status === 'resolved') {
    return {
      title: progress ? `Resolved · ${progress}` : 'Resolved',
      body: 'The agent marked this feedback loop resolved. Start a fresh Gloss review for new changes.'
    };
  }
  return null;
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp));
}
