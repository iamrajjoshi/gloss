import { ulid } from 'ulid';
import { create } from 'zustand';
import type { Comment, Side } from '../shared/types';

export interface DraftComment {
  filePath: string;
  side: Side;
  startLine: number;
  endLine: number;
  originalSnippet: string;
  anchor: { x: number; y: number };
}

interface ReviewState {
  comments: Comment[];
  draft: DraftComment | null;
  setDraft: (draft: DraftComment | null) => void;
  addComment: (body: string) => void;
  removeComment: (id: string) => void;
  reset: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  comments: [],
  draft: null,
  setDraft: (draft) => set({ draft }),
  addComment: (body) => {
    const draft = get().draft;
    if (!draft || body.trim().length === 0) {
      return;
    }
    set((state) => ({
      comments: [
        ...state.comments,
        {
          id: ulid(),
          filePath: draft.filePath,
          side: draft.side,
          startLine: Math.min(draft.startLine, draft.endLine),
          endLine: Math.max(draft.startLine, draft.endLine),
          body: body.trim(),
          originalSnippet: draft.originalSnippet,
          createdAt: new Date().toISOString()
        }
      ],
      draft: null
    }));
  },
  removeComment: (id) =>
    set((state) => ({
      comments: state.comments.filter((comment) => comment.id !== id)
    })),
  reset: () => set({ comments: [], draft: null })
}));
