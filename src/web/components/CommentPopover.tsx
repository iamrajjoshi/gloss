import { MessageSquarePlus, X } from 'lucide-react';
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

  const label =
    draft.startLine === draft.endLine
      ? `Comment on line ${draft.side}${draft.startLine}`
      : `Comment on range ${draft.side}${Math.min(draft.startLine, draft.endLine)}-${draft.side}${Math.max(draft.startLine, draft.endLine)}`;

  return (
    <div className="popover" style={{ left: draft.anchor.x, top: draft.anchor.y }}>
      <div className="popover-title">
        <span>Local comment</span>
        <button className="icon-button" type="button" title="Close" onClick={() => setDraft(null)}>
          <X size={15} />
        </button>
      </div>
      <div className="popover-subtitle">{label}</div>
      <textarea value={body} onChange={(event) => setBody(event.target.value)} />
      <div className="popover-actions">
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
