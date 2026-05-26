import { CheckCircle2, GitBranch, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ReviewRecord } from '../../shared/types';
import { fetchReview } from '../api';
import { DiffView } from '../components/DiffView';
import { SubmitBar } from '../components/SubmitBar';
import { useReviewStore } from '../store';

export function Review({ reviewId }: { reviewId: string }) {
  const [record, setRecord] = useState<ReviewRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reset = useReviewStore((state) => state.reset);
  const hydrateReview = useReviewStore((state) => state.hydrateReview);

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
  const readOnly = record.meta.status === 'submitted' || record.meta.status === 'resolved';

  return (
    <main className="review-shell">
      <header className="topbar">
        <div className="topbar-main">
          <img className="brand-mark" src="/logo.svg" alt="" />
          <div className="review-heading">
            <p className="product-name">Gloss</p>
            <h1>{scopeTitle(record)}</h1>
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
        <div className="branch-pill" title={record.meta.branch ?? 'Detached HEAD'}>
          <GitBranch size={16} />
          <span>{record.meta.branch ?? 'detached'}</span>
        </div>
      </header>
      {readOnly ? <ReviewStateBanner record={record} /> : null}
      <DiffView record={record} readOnly={readOnly} />
      {readOnly ? null : <SubmitBar reviewId={reviewId} onSubmitted={reloadReview} />}
    </main>
  );
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
  const counts = resolutionCounts(record);
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

function resolutionCounts(record: ReviewRecord): { total: number; resolved: number } {
  const commentIds = new Set((record.feedback?.comments ?? []).map((comment) => comment.id));
  const resolved = (record.resolution?.comments ?? []).filter((comment) =>
    commentIds.has(comment.commentId)
  ).length;
  return {
    total: commentIds.size,
    resolved
  };
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp));
}

function scopeTitle(record: ReviewRecord): string {
  switch (record.diff.scope.mode) {
    case 'branch':
      return 'Branch diff';
    case 'explicit':
      return `Diff against ${record.diff.scope.requestedBase ?? record.diff.base.ref}`;
    case 'working':
      return 'Working changes';
  }
}
