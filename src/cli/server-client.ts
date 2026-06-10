import type { JsonValue } from '../shared/json';
import type {
  ClearReviewsRequest,
  ClearReviewsResult,
  Comment,
  CreateReviewResponse,
  CreateReviewTurnResponse,
  DiffPayload,
  FeedbackBundle,
  HealthResponse,
  ListReviewsResponse,
  OpenResult,
  ResolutionRequest,
  ResolveResult,
  ReviewEvent,
  ReviewRecord,
  SubmitReviewRequest
} from '../shared/types';
import {
  isClearReviewsResult,
  isCreateReviewResponse,
  isCreateReviewTurnResponse,
  isFeedbackBundle,
  isHealthResponse,
  isListReviewsResponse,
  isOpenResult,
  isResolveResult,
  isReviewEvent,
  isReviewRecord,
  type JsonGuard,
  parseJson,
  parseJsonValue
} from '../shared/validation';

const timedWatchAttemptMs = 1000;

export class ServerClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<HealthResponse> {
    return this.get('/api/health', isHealthResponse, 'health response');
  }

  async createReview(diff: DiffPayload): Promise<CreateReviewResponse> {
    return this.post('/api/reviews', diff, isCreateReviewResponse, 'create review response');
  }

  async appendReviewTurn(reviewId: string, diff: DiffPayload): Promise<CreateReviewTurnResponse> {
    return this.post(
      `/api/reviews/${reviewId}/turns`,
      diff,
      isCreateReviewTurnResponse,
      'create review turn response'
    );
  }

  async getReview(reviewId: string): Promise<ReviewRecord> {
    return this.get(`/api/reviews/${reviewId}`, isReviewRecord, 'review response');
  }

  async listReviews(): Promise<ListReviewsResponse> {
    return this.get('/api/reviews', isListReviewsResponse, 'review list response');
  }

  async clearReviews(request: ClearReviewsRequest): Promise<ClearReviewsResult> {
    return this.post(
      '/api/maintenance/clear-reviews',
      request,
      isClearReviewsResult,
      'clear reviews response'
    );
  }

  async getFeedback(reviewId: string): Promise<FeedbackBundle> {
    return this.get(`/api/reviews/${reviewId}/feedback`, isFeedbackBundle, 'feedback response');
  }

  async markResolved(reviewId: string, summary?: string, turn?: string): Promise<ResolveResult> {
    const request: ResolutionRequest = { summary, turn };
    return this.post(
      `/api/reviews/${reviewId}/resolved`,
      request,
      isResolveResult,
      'resolve response'
    );
  }

  async resolveComment(
    reviewId: string,
    commentId: string,
    summary?: string
  ): Promise<ResolveResult> {
    const request: ResolutionRequest = { summary };
    return this.post(
      `/api/reviews/${reviewId}/comments/${commentId}/resolved`,
      request,
      isResolveResult,
      'resolve comment response'
    );
  }

  async reopenComment(reviewId: string, commentId: string): Promise<ResolveResult> {
    return this.delete(
      `/api/reviews/${reviewId}/comments/${commentId}/resolved`,
      isResolveResult,
      'reopen comment response'
    );
  }

  async submitReview(reviewId: string, comments: Comment[]): Promise<OpenResult> {
    const request: SubmitReviewRequest = { comments };
    return this.post(
      `/api/reviews/${reviewId}/submit`,
      request,
      isOpenResult,
      'submit review response'
    );
  }

  async watchReview(reviewId: string, timeoutSeconds?: number): Promise<ReviewEvent> {
    const deadline =
      timeoutSeconds && timeoutSeconds > 0 ? Date.now() + timeoutSeconds * 1000 : null;

    while (true) {
      const remainingMs = deadline ? deadline - Date.now() : null;
      if (remainingMs !== null && remainingMs <= 0) {
        throw new Error(`watch timed out after ${timeoutSeconds} seconds`);
      }

      const controller = new AbortController();
      const timeoutMs = remainingMs === null ? null : Math.min(remainingMs, timedWatchAttemptMs);
      const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        return await this.readReviewEvents(reviewId, controller.signal);
      } catch (error) {
        if (isAbortError(error)) {
          if (deadline && Date.now() < deadline) {
            throw new Error('watch stream ended before completion');
          }
          throw new Error(`watch timed out after ${timeoutSeconds} seconds`);
        }
        if (!isPrematureWatchEnd(error)) {
          throw error;
        }
        await sleep(500);
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }
  }

  private async readReviewEvents(reviewId: string, signal: AbortSignal): Promise<ReviewEvent> {
    const response = await fetch(`${this.baseUrl}/api/reviews/${reviewId}/events`, {
      signal
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
        const event = parseJson(dataLine.slice(5).trim(), isReviewEvent, 'review event');
        if (event.type === 'review.submitted' || event.type === 'review.cancelled') {
          await reader.cancel().catch(() => undefined);
          return event;
        }
      }
    }
  }

  private async get<T>(path: string, guard: JsonGuard<T>, label: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    return parseResponse(response, guard, label);
  }

  private async post<T>(
    path: string,
    body: ClearReviewsRequest | DiffPayload | ResolutionRequest | SubmitReviewRequest,
    guard: JsonGuard<T>,
    label: string
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return parseResponse(response, guard, label);
  }

  private async delete<T>(path: string, guard: JsonGuard<T>, label: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'DELETE' });
    return parseResponse(response, guard, label);
  }
}

async function parseResponse<T>(
  response: Response,
  guard: JsonGuard<T>,
  label: string
): Promise<T> {
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  const value: JsonValue = await response.json();
  return parseJsonValue(value, guard, label);
}

function isPrematureWatchEnd(error: unknown): error is Error {
  return error instanceof Error && error.message === 'watch stream ended before completion';
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
