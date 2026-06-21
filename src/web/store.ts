import { ulid } from 'ulid';
import { create } from 'zustand';
import type { Comment, ResolutionBundle, Side } from '../shared/types';

interface DraftComment {
  filePath: string;
  side: Side;
  startLine: number;
  endLine: number;
  originalSnippet: string;
}

interface ReviewState {
  comments: Comment[];
  resolution: ResolutionBundle | null;
  draft: DraftComment | null;
  setDraft: (draft: DraftComment | null) => void;
  hydrateComments: (comments: Comment[]) => void;
  hydrateReview: (comments: Comment[], resolution?: ResolutionBundle | null) => void;
  addComment: (body: string) => void;
  addGeneralComment: (body: string) => void;
  removeComment: (id: string) => void;
  reset: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  comments: [],
  resolution: null,
  draft: null,
  setDraft: (draft) => set({ draft }),
  hydrateComments: (comments) => set({ comments, resolution: null, draft: null }),
  hydrateReview: (comments, resolution = null) => set({ comments, resolution, draft: null }),
  addComment: (body) => {
    const draft = get().draft;
    if (!draft || body.trim().length === 0) {
      return;
    }
    set((state) => ({
      comments: [
        ...state.comments,
        {
          kind: 'line',
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
  addGeneralComment: (body) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      return;
    }
    set((state) => ({
      comments: [
        ...state.comments,
        {
          kind: 'general',
          id: ulid(),
          body: trimmed,
          createdAt: new Date().toISOString()
        }
      ]
    }));
  },
  removeComment: (id) =>
    set((state) => ({
      comments: state.comments.filter((comment) => comment.id !== id)
    })),
  reset: () => set({ comments: [], resolution: null, draft: null })
}));
