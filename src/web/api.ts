import type { Comment, OpenResult, ReviewRecord, SubmitReviewRequest } from '../shared/types';
import { isOpenResult, isReviewRecord, type JsonGuard, parseJsonValue } from '../shared/validation';

async function json<T>(response: Response, guard: JsonGuard<T>, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  const value: unknown = await response.json();
  return parseJsonValue(value, guard, label);
}

export async function fetchReview(reviewId: string): Promise<ReviewRecord> {
  return json(await fetch(`/api/reviews/${reviewId}`), isReviewRecord, 'review response');
}

export async function submitReview(reviewId: string, comments: Comment[]): Promise<OpenResult> {
  const request: SubmitReviewRequest = { comments };
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
