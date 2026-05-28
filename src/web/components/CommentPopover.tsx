import { MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { formatLineRange } from '../../shared/comments';
import type { DiffLineType } from '../../shared/types';
import { isSubmitCommentShortcut } from '../shortcuts';
import { useReviewStore } from '../store';

export function CommentComposer({ tone }: { tone: DiffLineType }) {
  const draft = useReviewStore((state) => state.draft);
  const setDraft = useReviewStore((state) => state.setDraft);
  const addComment = useReviewStore((state) => state.addComment);
  const [body, setBody] = useState('');

  if (!draft) {
    return null;
  }

  const label =
    draft.startLine === draft.endLine
      ? `Comment on line ${formatLineRange(draft)}`
      : `Comment on range ${formatLineRange(draft)}`;
  const cancelDraft = () => {
    setBody('');
    setDraft(null);
  };
  const submitComment = () => {
    addComment(body);
    setBody('');
  };

  return (
    <div className={`draft-comment-shell tone-${tone}`}>
      <div className="draft-comment-card">
        <div className="draft-comment-title">
          <span className="draft-comment-heading">
            <span className="draft-comment-icon" aria-hidden="true">
              <MessageSquarePlus size={15} />
            </span>
            <span>Local comment</span>
          </span>
          <span className="draft-comment-label">{label}</span>
        </div>
        <textarea
          aria-label={label}
          placeholder="Request change"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (isSubmitCommentShortcut(event)) {
              event.preventDefault();
              submitComment();
            }
          }}
        />
        <div className="draft-comment-actions">
          <button className="secondary-button" type="button" onClick={cancelDraft}>
            Cancel
          </button>
          <button
            aria-keyshortcuts="Meta+Enter"
            className="primary-button"
            title="Comment (Command+Enter)"
            type="button"
            onClick={submitComment}
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}
