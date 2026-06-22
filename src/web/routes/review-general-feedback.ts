import { isLineComment } from '../../shared/comments';
import type {
  FeedbackBundle,
  GeneralComment,
  ResolutionBundle,
  ResolvedComment
} from '../../shared/types';

export interface SubmittedGeneralFeedbackItem {
  comment: GeneralComment;
  resolvedComment: ResolvedComment | null;
  status: 'open' | 'resolved';
  summary: string | null;
}

export function submittedGeneralFeedbackItems(
  feedback: FeedbackBundle | undefined,
  resolution?: ResolutionBundle | null
): SubmittedGeneralFeedbackItem[] {
  const resolvedByCommentId = new Map(
    (resolution?.comments ?? []).map((comment) => [comment.commentId, comment])
  );

  return (feedback?.comments ?? [])
    .filter((comment): comment is GeneralComment => !isLineComment(comment))
    .map((comment) => {
      const resolvedComment = resolvedByCommentId.get(comment.id) ?? null;
      return {
        comment,
        resolvedComment,
        status: resolvedComment ? 'resolved' : 'open',
        summary: resolvedComment?.summary ?? null
      };
    });
}
