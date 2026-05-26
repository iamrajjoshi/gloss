import type {
  Comment,
  DiffPayload,
  FeedbackBundle,
  OpenResult,
  ResolveResult,
  ReviewEvent,
  ReviewMeta,
  ReviewRecord
} from '../shared/types';

export class ServerClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<{ ok: boolean; version: string; activeReviews: number }> {
    return this.get('/api/health');
  }

  async createReview(diff: DiffPayload): Promise<{ meta: ReviewMeta; url: string }> {
    return this.post('/api/reviews', diff);
  }

  async getReview(reviewId: string): Promise<ReviewRecord> {
    return this.get(`/api/reviews/${reviewId}`);
  }

  async listReviews(): Promise<{ reviews: ReviewMeta[] }> {
    return this.get('/api/reviews');
  }

  async getFeedback(reviewId: string): Promise<FeedbackBundle> {
    return this.get(`/api/reviews/${reviewId}/feedback`);
  }

  async markResolved(reviewId: string, summary?: string): Promise<ResolveResult> {
    return this.post(`/api/reviews/${reviewId}/resolved`, { summary });
  }

  async resolveComment(
    reviewId: string,
    commentId: string,
    summary?: string
  ): Promise<ResolveResult> {
    return this.post(`/api/reviews/${reviewId}/comments/${commentId}/resolved`, { summary });
  }

  async reopenComment(reviewId: string, commentId: string): Promise<ResolveResult> {
    return this.delete(`/api/reviews/${reviewId}/comments/${commentId}/resolved`);
  }

  async submitReview(reviewId: string, comments: Comment[]): Promise<OpenResult> {
    return this.post(`/api/reviews/${reviewId}/submit`, { comments });
  }

  async watchReview(reviewId: string, timeoutSeconds?: number): Promise<ReviewEvent> {
    const controller = new AbortController();
    const timeout =
      timeoutSeconds && timeoutSeconds > 0
        ? setTimeout(() => controller.abort(), timeoutSeconds * 1000)
        : null;

    try {
      const response = await fetch(`${this.baseUrl}/api/reviews/${reviewId}/events`, {
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        throw new Error(`watch failed: ${response.status} ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          throw new Error('watch stream ended before completion');
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const eventChunk of events) {
          const dataLine = eventChunk.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) {
            continue;
          }
          const event = JSON.parse(dataLine.slice(5).trim()) as ReviewEvent;
          if (event.type === 'review.submitted' || event.type === 'review.cancelled') {
            return event;
          }
        }
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    return parseResponse<T>(response);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return parseResponse<T>(response);
  }

  private async delete<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'DELETE' });
    return parseResponse<T>(response);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}
