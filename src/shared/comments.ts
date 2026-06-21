import type {
  Comment,
  FeedbackBundle,
  LineComment,
  ResolutionBundle,
  ResolutionCounts,
  ResolvedComment,
  Side
} from './types';

export interface LineRange {
  side: Side;
  startLine: number;
  endLine: number;
}

export function isLineComment(comment: Comment): comment is LineComment {
  return comment.kind === undefined || comment.kind === 'line';
}

export function compareCommentsByLocation(a: Comment, b: Comment): number {
  const aIsLine = isLineComment(a);
  const bIsLine = isLineComment(b);
  if (!aIsLine || !bIsLine) {
    if (aIsLine !== bIsLine) {
      return aIsLine ? 1 : -1;
    }
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  }

  return (
    a.filePath.localeCompare(b.filePath) ||
    a.startLine - b.startLine ||
    a.endLine - b.endLine ||
    a.side.localeCompare(b.side)
  );
}

export function countCommentFiles(comments: Comment[]): number {
  const filePaths = new Set<string>();
  for (const comment of comments) {
    if (isLineComment(comment)) {
      filePaths.add(comment.filePath);
    }
  }
  return filePaths.size;
}

export function formatLineRange(
  range: LineRange,
  options: { repeatSideOnEnd?: boolean } = {}
): string {
  const startLine = Math.min(range.startLine, range.endLine);
  const endLine = Math.max(range.startLine, range.endLine);
  if (startLine === endLine) {
    return `${range.side}${startLine}`;
  }
  const endPrefix = options.repeatSideOnEnd === false ? '' : range.side;
  return `${range.side}${startLine}-${endPrefix}${endLine}`;
}

export function resolutionCounts(
  feedback: FeedbackBundle | undefined,
  resolvedComments: ResolvedComment[] = []
): ResolutionCounts {
  const comments = feedback?.comments ?? [];
  const resolvedIds = new Set(resolvedComments.map((comment) => comment.commentId));
  const resolved = comments.filter((comment) => resolvedIds.has(comment.id)).length;
  return {
    total: comments.length,
    resolved,
    open: comments.length - resolved
  };
}

export function reviewResolutionCounts(record: {
  feedback?: FeedbackBundle;
  resolution?: ResolutionBundle;
}): ResolutionCounts {
  return resolutionCounts(record.feedback, record.resolution?.comments ?? []);
}
