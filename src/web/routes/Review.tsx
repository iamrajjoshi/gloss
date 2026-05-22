import { GitBranch, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReviewRecord } from '../../shared/types';
import { fetchReview } from '../api';
import { DiffView } from '../components/DiffView';
import { SubmitBar } from '../components/SubmitBar';
import { useReviewStore } from '../store';

export function Review({ reviewId }: { reviewId: string }) {
  const [record, setRecord] = useState<ReviewRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reset = useReviewStore((state) => state.reset);

  useEffect(() => {
    reset();
    fetchReview(reviewId)
      .then(setRecord)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [reviewId, reset]);

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
      <DiffView record={record} />
      <SubmitBar reviewId={reviewId} />
    </main>
  );
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
