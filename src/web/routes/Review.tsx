import {
  CheckCircle2,
  FileCode2,
  GitBranch,
  LoaderCircle,
  MoveHorizontal,
  PanelLeftOpen,
  WrapText,
  X
} from 'lucide-react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { reviewResolutionCounts } from '../../shared/comments';
import { reviewDisplayTitle } from '../../shared/review-title';
import { isResolvableReviewStatus } from '../../shared/reviews';
import type { ReviewRecord } from '../../shared/types';
import { isReviewEvent, parseJson } from '../../shared/validation';
import { fetchReview } from '../api';
import { DiffView, fileCardElementId } from '../components/DiffView';
import { buildExtensionBuckets, FileTree, filterDiffFiles } from '../components/FileTree';
import { SubmitBar } from '../components/SubmitBar';
import { useReviewStore } from '../store';

export interface FileFilterState {
  extensionIds: string[];
  reviewId: string | null;
  searchQuery: string;
  selectedExtensionIds: Set<string>;
}

const FILE_TREE_MIN_WIDTH = 300;
const FILE_TREE_MAX_WIDTH = 560;
const FILE_TREE_DEFAULT_WIDTH = 360;

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
  const reset = useReviewStore((state) => state.reset);
  const hydrateReview = useReviewStore((state) => state.hydrateReview);
  const displayTitle = record ? reviewDisplayTitle(record) : null;
  const reviewFiles = record?.diff.files ?? [];
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
    setFilterState((current) => {
      return syncFileFilterState(current, recordId, extensionIds);
    });
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

  if (!record) {
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
  const stats = record.diff.stats;
  const readOnly = isResolvableReviewStatus(record.meta.status);
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
  const renderFileTree = () => (
    <FileTree
      activeFilePath={activeFilePath}
      extensionBuckets={extensionBuckets}
      files={record.diff.files}
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
      files={record.diff.files}
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
    record.diff.files.length === 0 ? null : (
      <div className="empty-diff filtered-empty">
        <h2>No matching files</h2>
        <p>Adjust the file search or extension filters to show changed files.</p>
      </div>
    );

  return (
    <main className="review-shell">
      <header className="topbar">
        <div className="topbar-main">
          <img className="brand-mark" src="/logo.svg" alt="" />
          <div className="review-heading">
            <h1>{displayTitle}</h1>
            <div className="meta-row">
              <span title={`${scope.base.ref} (${scope.base.sha})`}>
                Base {scope.base.ref} ({scope.base.sha.slice(0, 7)})
              </span>
              <span
                title={`${scope.comparison.ref}${scope.comparison.sha ? ` (${scope.comparison.sha})` : ''}`}
              >
                Compare {scope.comparison.ref}
                {scope.comparison.sha ? ` (${scope.comparison.sha.slice(0, 7)})` : ''}
              </span>
              <span>
                {stats.files} {stats.files === 1 ? 'file' : 'files'}
              </span>
              <span>
                +{stats.additions} -{stats.deletions}
              </span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
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
      </header>
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
            emptyState={filteredEmptyState}
            files={filteredFiles}
            record={record}
            readOnly={readOnly}
            wrapLines={wrapLines}
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
