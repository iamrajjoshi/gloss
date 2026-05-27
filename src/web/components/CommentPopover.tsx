import { MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { formatLineRange } from '../../shared/comments';
import type { DiffLineType } from '../../shared/types';
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
        />
        <div className="draft-comment-actions">
          <button className="secondary-button" type="button" onClick={cancelDraft}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              addComment(body);
              setBody('');
            }}
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}
