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

  return (
    <main className="review-shell">
      <header className="topbar">
        <div>
          <div className="brand-row">
            <span className="brand-mark">G</span>
            <h1>Gloss</h1>
          </div>
          <p className="muted">
            Base {record.meta.base.ref} ({record.meta.base.sha.slice(0, 7)})
          </p>
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
