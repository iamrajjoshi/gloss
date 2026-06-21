import { Check, MessageSquare, Plus, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatLineRange, isLineComment } from '../../shared/comments';
import { formatError } from '../../shared/errors';
import type { Comment, GeneralComment, LineComment, ReviewScope } from '../../shared/types';
import { submitReview } from '../api';
import { isSubmitCommentShortcut, isSubmitReviewShortcut } from '../shortcuts';
import { useReviewStore } from '../store';

export function SubmitBar({
  reviewId,
  reviewScope,
  onLineCommentSelect,
  onSubmitted
}: {
  reviewId: string;
  reviewScope?: ReviewScope;
  onLineCommentSelect?: (comment: LineComment) => void;
  onSubmitted?: () => Promise<void> | void;
}) {
  const comments = useReviewStore((state) => state.comments);
  const addGeneralComment = useReviewStore((state) => state.addGeneralComment);
  const removeComment = useReviewStore((state) => state.removeComment);
  const [generalCommentBody, setGeneralCommentBody] = useState('');
  const [selectedGeneralCommentId, setSelectedGeneralCommentId] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const generalDialogRef = useRef<HTMLDialogElement | null>(null);
  const submittingRef = useRef(false);
  const canSubmit = state !== 'submitting' && state !== 'done';
  const trimmedGeneralCommentBody = generalCommentBody.trim();
  const lineComments = comments.filter(isLineComment);
  const generalComments = comments.filter(
    (comment): comment is GeneralComment => !isLineComment(comment)
  );
  const selectedGeneralComment =
    selectedGeneralCommentId === null
      ? null
      : (generalComments.find((comment) => comment.id === selectedGeneralCommentId) ?? null);
  const hasLineComments = lineComments.length > 0;
  const closeGeneralCommentDialog = useCallback(() => setSelectedGeneralCommentId(null), []);
  const submitGeneralComment = () => {
    if (!trimmedGeneralCommentBody) {
      return;
    }
    addGeneralComment(trimmedGeneralCommentBody);
    setGeneralCommentBody('');
  };
  const submit = useCallback(async () => {
    if (!canSubmit || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setState('submitting');
    setMessage(null);
    try {
      await submitReview(reviewId, comments, reviewScope);
      setState('done');
      setMessage('Submitted');
      try {
        await onSubmitted?.();
      } catch (error) {
        setMessage(`Submitted, but refresh failed: ${formatError(error)}`);
      }
    } catch (error) {
      submittingRef.current = false;
      setState('error');
      setMessage(formatError(error));
    }
  }, [canSubmit, comments, onSubmitted, reviewId, reviewScope]);

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

  useEffect(() => {
    if (selectedGeneralCommentId !== null && selectedGeneralComment === null) {
      setSelectedGeneralCommentId(null);
    }
  }, [selectedGeneralComment, selectedGeneralCommentId]);

  useEffect(() => {
    if (selectedGeneralComment === null) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeGeneralCommentDialog();
      }
    };
    generalDialogRef.current?.focus();
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeGeneralCommentDialog, selectedGeneralComment]);

  return (
    <>
      <aside className="submit-bar">
        <div className="feedback-panel">
          {hasLineComments ? (
            <div className="inline-feedback-row">
              <span className="feedback-row-label inline-feedback-label">
                <MessageSquare size={14} />
                Inline feedback
                <span className="feedback-row-count">{lineComments.length}</span>
              </span>
              <div className="comment-list">
                {lineComments.map((comment) => {
                  const chip = commentChipInfo(comment);
                  return (
                    <div
                      className={`comment-chip ${chip.tone}`}
                      key={comment.id}
                      title={chip.title}
                    >
                      <button
                        className="comment-chip-target"
                        type="button"
                        title={`Jump to ${chip.title}`}
                        onClick={() => onLineCommentSelect?.(comment)}
                      >
                        <span className="comment-chip-kind">{chip.kind}</span>
                        <span className="comment-chip-text">{chip.text}</span>
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        title="Remove comment"
                        onClick={() => removeComment(comment.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {generalComments.length > 0 ? (
            <div className="general-feedback-summary-row">
              <span className="feedback-row-label general-feedback-label">
                <MessageSquare size={14} />
                General feedback
                <span className="feedback-row-count general-feedback-count">
                  {generalComments.length}
                </span>
              </span>
              <div className="general-feedback-list">
                {generalComments.map((comment) => {
                  const chip = commentChipInfo(comment);
                  return (
                    <div
                      className={`comment-chip ${chip.tone}`}
                      key={comment.id}
                      title={chip.title}
                    >
                      <button
                        className="comment-chip-target"
                        type="button"
                        title="View general feedback"
                        onClick={() => setSelectedGeneralCommentId(comment.id)}
                      >
                        <span className="comment-chip-kind">{chip.kind}</span>
                        <span className="comment-chip-text">{chip.text}</span>
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        title="Remove comment"
                        onClick={() => removeComment(comment.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="general-feedback-row">
            <form
              className="general-comment-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitGeneralComment();
              }}
            >
              <div className="general-comment-compose">
                <MessageSquare className="general-comment-compose-icon" size={15} />
                <textarea
                  aria-label="General feedback"
                  placeholder="General feedback"
                  rows={1}
                  value={generalCommentBody}
                  onChange={(event) => setGeneralCommentBody(event.target.value)}
                  onKeyDown={(event) => {
                    if (isSubmitCommentShortcut(event)) {
                      event.preventDefault();
                      submitGeneralComment();
                    }
                  }}
                />
                <button
                  aria-keyshortcuts="Meta+Enter"
                  className="general-comment-add"
                  type="submit"
                  disabled={!trimmedGeneralCommentBody}
                  title="Add general feedback (Command+Enter)"
                >
                  <Plus size={14} />
                  <span>Add</span>
                </button>
              </div>
            </form>
          </div>
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
      {selectedGeneralComment
        ? createPortal(
            <div className="general-feedback-dialog-backdrop">
              <dialog
                aria-labelledby="general-feedback-dialog-title"
                aria-modal="true"
                className="general-feedback-dialog"
                ref={generalDialogRef}
                open
                tabIndex={-1}
              >
                <header className="general-feedback-dialog-header">
                  <h2 id="general-feedback-dialog-title">General feedback</h2>
                  <button
                    aria-label="Close general feedback"
                    className="icon-button general-feedback-dialog-close"
                    type="button"
                    onClick={closeGeneralCommentDialog}
                  >
                    <X size={18} />
                  </button>
                </header>
                <div className="general-feedback-dialog-body">
                  <p className="general-feedback-dialog-text">{selectedGeneralComment.body}</p>
                </div>
                <footer className="general-feedback-dialog-footer">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      removeComment(selectedGeneralComment.id);
                      closeGeneralCommentDialog();
                    }}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={closeGeneralCommentDialog}
                  >
                    Close
                  </button>
                </footer>
              </dialog>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function commentChipInfo(comment: Comment): {
  kind: string;
  text: string;
  title: string;
  tone: 'general' | 'line';
} {
  if (!isLineComment(comment)) {
    return {
      kind: 'General',
      text: comment.body,
      title: comment.body,
      tone: 'general'
    };
  }

  const location = `${comment.filePath}:${formatLineRange(comment, { repeatSideOnEnd: false })}`;
  return {
    kind: 'Line',
    text: location,
    title: location,
    tone: 'line'
  };
}
