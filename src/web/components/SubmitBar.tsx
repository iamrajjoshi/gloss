import { Check, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatLineRange } from '../../shared/comments';
import { submitReview } from '../api';
import { isSubmitReviewShortcut } from '../shortcuts';
import { useReviewStore } from '../store';

export function SubmitBar({
  reviewId,
  onSubmitted
}: {
  reviewId: string;
  onSubmitted?: () => Promise<void> | void;
}) {
  const comments = useReviewStore((state) => state.comments);
  const removeComment = useReviewStore((state) => state.removeComment);
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const canSubmit = state !== 'submitting' && state !== 'done';
  const submit = useCallback(async () => {
    if (!canSubmit || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setState('submitting');
    setMessage(null);
    try {
      await submitReview(reviewId, comments);
      setState('done');
      setMessage('Submitted');
      try {
        await onSubmitted?.();
      } catch {
        // The feedback handoff succeeded; leave the submitted state visible even if refresh fails.
      }
    } catch (error) {
      submittingRef.current = false;
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [canSubmit, comments, onSubmitted, reviewId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSubmitReviewShortcut(event)) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submit]);

  return (
    <aside className="submit-bar">
      <div className="comment-list">
        {comments.length === 0 ? (
          <span className="muted">No comments yet</span>
        ) : (
          comments.map((comment) => (
            <div className="comment-chip" key={comment.id}>
              <span>
                {comment.filePath}:{formatLineRange(comment, { repeatSideOnEnd: false })}
              </span>
              <button
                className="icon-button"
                type="button"
                title="Remove comment"
                onClick={() => removeComment(comment.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="submit-actions">
        {message ? <span className={`submit-message ${state}`}>{message}</span> : null}
        <button
          aria-keyshortcuts="Meta+Shift+Enter"
          className="primary-button"
          type="button"
          disabled={!canSubmit}
          title="Submit review (Command+Shift+Enter)"
          onClick={submit}
        >
          {state === 'done' ? <Check size={16} /> : <Send size={16} />}
          Submit {comments.length}
        </button>
      </div>
    </aside>
  );
}
