import type { JsonValue } from '../shared/json';
import type {
  Comment,
  CommitRangeDiffRequest,
  CommitRangeDiffResponse,
  DiffContextRequest,
  DiffContextResponse,
  DiffContextSource,
  FileContentRequest,
  FileContentResponse,
  OpenFileRequest,
  OpenFileResponse,
  OpenFileScope,
  OpenFileTarget,
  OpenFileTargetsResponse,
  OpenResult,
  ReviewRecord,
  ReviewScope,
  Side,
  SourcePeekRangeRequest,
  SourcePeekRangeResponse,
  SourcePeekRequest,
  SourcePeekResponse,
  SubmitReviewRequest
} from '../shared/types';
import {
  isCommitRangeDiffResponse,
  isDiffContextResponse,
  isFileContentResponse,
  isOpenFileResponse,
  isOpenFileTargetsResponse,
  isOpenResult,
  isReviewRecord,
  isSourcePeekRangeResponse,
  isSourcePeekResponse,
  type JsonGuard,
  parseJsonValue
} from '../shared/validation';

async function json<T>(response: Response, guard: JsonGuard<T>, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  const value: JsonValue = await response.json();
  return parseJsonValue(value, guard, label);
}

async function responseErrorMessage(response: Response): Promise<string> {
  const body = await response.text();
  const message = errorMessageFromBody(body);
  return message ?? `${response.status}: ${body || response.statusText}`;
}

function errorMessageFromBody(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).error === 'string'
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // Plain text responses still fall back to status-prefixed messages.
  }
  return null;
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
  turnId?: string,
  options: { scope?: OpenFileScope; target?: OpenFileTarget } = {}
): Promise<OpenFileResponse> {
  const request: OpenFileRequest = { filePath, turnId, ...options };
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

export async function fetchOpenFileTargets(): Promise<OpenFileTargetsResponse> {
  return json(await fetch('/api/open-targets'), isOpenFileTargetsResponse, 'open targets response');
}

export async function fetchReviewFileContent(
  reviewId: string,
  filePath: string,
  turnId?: string,
  options: { scope?: OpenFileScope } = {}
): Promise<FileContentResponse> {
  const request: FileContentRequest = { filePath, turnId, ...options };
  return json(
    await fetch(`/api/reviews/${reviewId}/files/content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    }),
    isFileContentResponse,
    'file content response'
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

export async function fetchSourcePeek({
  column,
  filePath,
  line,
  oldPath,
  reviewId,
  side,
  source,
  symbol,
  turnId
}: {
  reviewId: string;
  filePath: string;
  oldPath: string | null;
  turnId?: string;
  source: DiffContextSource;
  side: Side;
  line: number;
  column: number;
  symbol: string;
}): Promise<SourcePeekResponse> {
  const request: SourcePeekRequest = {
    filePath,
    oldPath,
    turnId,
    source,
    side,
    line,
    column,
    symbol
  };
  return json(
    await fetch(`/api/reviews/${reviewId}/source-peek`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    }),
    isSourcePeekResponse,
    'source peek response'
  );
}

export async function fetchSourcePeekRange({
  filePath,
  lineCount,
  reviewId,
  side,
  source,
  startLine,
  turnId
}: {
  reviewId: string;
  filePath: string;
  turnId?: string;
  source: DiffContextSource;
  side: Side;
  startLine: number;
  lineCount: number;
}): Promise<SourcePeekRangeResponse> {
  const request: SourcePeekRangeRequest = {
    filePath,
    turnId,
    source,
    side,
    startLine,
    lineCount
  };
  return json(
    await fetch(`/api/reviews/${reviewId}/source-peek/range`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    }),
    isSourcePeekRangeResponse,
    'source peek range response'
  );
}
