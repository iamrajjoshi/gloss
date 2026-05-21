import type { Comment, OpenResult, ReviewRecord } from '../shared/types';

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function fetchReview(reviewId: string): Promise<ReviewRecord> {
  return json(await fetch(`/api/reviews/${reviewId}`));
}

export async function submitReview(reviewId: string, comments: Comment[]): Promise<OpenResult> {
  return json(
    await fetch(`/api/reviews/${reviewId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments })
    })
  );
}
