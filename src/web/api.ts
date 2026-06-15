import type { JsonValue } from '../shared/json';
import type {
  Comment,
  CommitRangeDiffRequest,
  CommitRangeDiffResponse,
  DiffContextRequest,
  DiffContextResponse,
  DiffContextSource,
  OpenFileRequest,
  OpenFileResponse,
  OpenResult,
  ReviewRecord,
  ReviewScope,
  SubmitReviewRequest
} from '../shared/types';
import {
  isCommitRangeDiffResponse,
  isDiffContextResponse,
  isOpenFileResponse,
  isOpenResult,
  isReviewRecord,
  type JsonGuard,
  parseJsonValue
} from '../shared/validation';

async function json<T>(response: Response, guard: JsonGuard<T>, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  const value: JsonValue = await response.json();
  return parseJsonValue(value, guard, label);
}

export async function fetchReview(reviewId: string): Promise<ReviewRecord> {
  return json(await fetch(`/api/reviews/${reviewId}`), isReviewRecord, 'review response');
}

export async function submitReview(
  reviewId: string,
  comments: Comment[],
  reviewScope?: ReviewScope
): Promise<OpenResult> {
  const request: SubmitReviewRequest = { comments, reviewScope };
  return json(
    await fetch(`/api/reviews/${reviewId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    }),
    isOpenResult,
    'submit review response'
  );
}

export async function openReviewFile(
  reviewId: string,
  filePath: string,
  turnId?: string
): Promise<OpenFileResponse> {
  const request: OpenFileRequest = { filePath, turnId };
  return json(
    await fetch(`/api/reviews/${reviewId}/files/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    }),
    isOpenFileResponse,
    'open file response'
  );
}

export async function fetchCommitRangeDiff(
  reviewId: string,
  fromSha: string,
  toSha: string,
  turnId?: string
): Promise<CommitRangeDiffResponse> {
  const request: CommitRangeDiffRequest = { fromSha, toSha, turnId };
  return json(
    await fetch(`/api/reviews/${reviewId}/commits/range`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    }),
    isCommitRangeDiffResponse,
    'commit range diff response'
  );
}

export async function fetchDiffContext({
  filePath,
  lineCount,
  newStart,
  oldPath,
  oldStart,
  reviewId,
  source,
  turnId
}: {
  reviewId: string;
  filePath: string;
  oldPath: string | null;
  turnId?: string;
  source: DiffContextSource;
  oldStart: number;
  newStart: number;
  lineCount: number;
}): Promise<DiffContextResponse> {
  const request: DiffContextRequest = {
    filePath,
    oldPath,
    turnId,
    source,
    oldStart,
    newStart,
    lineCount
  };
  return json(
    await fetch(`/api/reviews/${reviewId}/files/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    }),
    isDiffContextResponse,
    'diff context response'
  );
}
