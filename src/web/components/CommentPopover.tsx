import { MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { useReviewStore } from '../store';

export function CommentPopover() {
  const draft = useReviewStore((state) => state.draft);
  const setDraft = useReviewStore((state) => state.setDraft);
  const addComment = useReviewStore((state) => state.addComment);
  const [body, setBody] = useState('');

  if (!draft) {
    return null;
  }

  const location =
    draft.startLine === draft.endLine
      ? `${draft.side}${draft.startLine}`
      : `${draft.side}${Math.min(draft.startLine, draft.endLine)}-${draft.side}${Math.max(draft.startLine, draft.endLine)}`;

  return (
    <div className="popover" draggable={false}>
      <div className="popover-title">
        <span className="popover-file">{draft.filePath}</span>
        <span className="popover-location">{location}</span>
      </div>
      <textarea value={body} onChange={(event) => setBody(event.target.value)} />
      <div className="popover-actions">
        <button className="secondary-button" type="button" onClick={() => setDraft(null)}>
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
          <MessageSquarePlus size={16} />
          Comment
        </button>
      </div>
    </div>
  );
}
