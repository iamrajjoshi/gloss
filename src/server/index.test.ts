import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  globalReviewDir,
  globalReviewFeedbackFile,
  globalReviewResolvedFile
} from '../shared/paths';
import type { ReviewEvent } from '../shared/types';
import {
  isCreateReviewResponse,
  isListReviewsResponse,
  isOpenResult,
  isResolveResult,
  isReviewEvent,
  isReviewRecord,
  type JsonGuard,
  parseJson,
  parseJsonValue
} from '../shared/validation';
import { makeComment, makeDiff } from '../test/factories';

const originalStateDir = process.env.GLOSS_STATE_DIR;
let tempDirs: string[] = [];
let repoRoot = '';

beforeEach(async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-api-state-'));
  repoRoot = await mkdtemp(path.join(tmpdir(), 'gloss-api-repo-'));
  tempDirs = [stateDir, repoRoot];
  process.env.GLOSS_STATE_DIR = stateDir;
  vi.resetModules();
});

afterEach(async () => {
  if (originalStateDir === undefined) {
    delete process.env.GLOSS_STATE_DIR;
  } else {
    process.env.GLOSS_STATE_DIR = originalStateDir;
  }
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Gloss review API global persistence', () => {
  it('creates, submits, lists, and reloads reviews from global state', async () => {
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    const diff = makeApiDiff();

    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(diff)
    });
    const created = await responseJson(
      createdResponse,
      isCreateReviewResponse,
      'create review response'
    );

    expect(createdResponse.status).toBe(201);
    expect(created.url).toBe(`http://localhost:4321/review/${created.meta.id}`);
    expect(created.meta.artifactDir).toBe(globalReviewDir(created.meta.id));
    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);

    const submittedResponse = await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment()] })
    });
    const submitted = await responseJson(submittedResponse, isOpenResult, 'submit review response');

    expect(submitted.artifactDir).toBe(globalReviewDir(created.meta.id));
    expect(submitted.feedbackPath).toBe(globalReviewFeedbackFile(created.meta.id));

    vi.resetModules();
    const { createApp: createReloadedApp } = await import('./index');
    const reloadedApp = createReloadedApp('http://localhost:4321');
    const listResponse = await reloadedApp.request('/api/reviews');
    const list = await responseJson(listResponse, isListReviewsResponse, 'review list response');
    const eventsResponse = await reloadedApp.request(`/api/reviews/${created.meta.id}/events`);
    const events = await readReviewEvents(eventsResponse, 2);

    expect(list.reviews.map((review) => review.id)).toEqual([created.meta.id]);
    expect(list.reviews[0]?.status).toBe('submitted');
    expect(events).toMatchObject([
      { type: 'review.opened', reviewId: created.meta.id },
      { type: 'review.submitted', reviewId: created.meta.id }
    ]);
  });

  it('rejects submitting a submitted or resolved review', async () => {
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeApiDiff())
    });
    const created = await responseJson(
      createdResponse,
      isCreateReviewResponse,
      'create review response'
    );

    const firstSubmitResponse = await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment()] })
    });
    const submittedAgainResponse = await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment()] })
    });

    expect(firstSubmitResponse.status).toBe(200);
    expect(submittedAgainResponse.status).toBe(409);

    await app.request(`/api/reviews/${created.meta.id}/resolved`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: 'fixed locally' })
    });
    const resolvedSubmitResponse = await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment()] })
    });

    expect(resolvedSubmitResponse.status).toBe(409);
  });

  it('rejects malformed JSON request bodies', async () => {
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeApiDiff())
    });
    const created = await responseJson(
      createdResponse,
      isCreateReviewResponse,
      'create review response'
    );
    await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment()] })
    });

    const response = await app.request(`/api/reviews/${created.meta.id}/resolved`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json'
    });
    const body = await responseJson(response, isErrorResponse, 'error response');

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/invalid JSON body/);
  });

  it('resolves and reopens individual comments through the API', async () => {
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeApiDiff())
    });
    const created = await responseJson(
      createdResponse,
      isCreateReviewResponse,
      'create review response'
    );

    await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        comments: [makeComment({ id: 'comment-1' }), makeComment({ id: 'comment-2' })]
      })
    });

    const partialResponse = await app.request(
      `/api/reviews/${created.meta.id}/comments/comment-1/resolved`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary: 'fixed first comment' })
      }
    );
    const partial = await responseJson(partialResponse, isResolveResult, 'resolve response');

    expect(partialResponse.status).toBe(200);
    expect(partial).toMatchObject({
      ok: true,
      reviewId: created.meta.id,
      status: 'submitted',
      resolutionStatus: 'partial',
      comments: { total: 2, resolved: 1, open: 1 },
      path: globalReviewResolvedFile(created.meta.id)
    });

    const hydratedResponse = await app.request(`/api/reviews/${created.meta.id}`);
    const hydrated = await responseJson(hydratedResponse, isReviewRecord, 'review response');

    expect(hydrated.meta.status).toBe('submitted');
    expect(hydrated.resolution?.comments).toMatchObject([
      { commentId: 'comment-1', summary: 'fixed first comment' }
    ]);

    const completeResponse = await app.request(
      `/api/reviews/${created.meta.id}/comments/comment-2/resolved`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      }
    );
    const complete = await responseJson(completeResponse, isResolveResult, 'resolve response');

    expect(complete).toMatchObject({
      status: 'resolved',
      resolutionStatus: 'resolved',
      comments: { total: 2, resolved: 2, open: 0 }
    });

    const reopenResponse = await app.request(
      `/api/reviews/${created.meta.id}/comments/comment-1/resolved`,
      { method: 'DELETE' }
    );
    const reopened = await responseJson(reopenResponse, isResolveResult, 'resolve response');

    expect(reopened).toMatchObject({
      status: 'submitted',
      resolutionStatus: 'partial',
      comments: { total: 2, resolved: 1, open: 1 }
    });
  });

  it('keeps live review events open and emits updates for resolution changes', async () => {
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeApiDiff())
    });
    const created = await responseJson(
      createdResponse,
      isCreateReviewResponse,
      'create review response'
    );

    await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        comments: [makeComment({ id: 'comment-1' }), makeComment({ id: 'comment-2' })]
      })
    });

    const eventsResponse = await app.request(`/api/reviews/${created.meta.id}/events`);
    const updates = readReviewUpdatedEvents(eventsResponse, 3);

    await app.request(`/api/reviews/${created.meta.id}/resolved`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: 'fixed all comments' })
    });
    await app.request(`/api/reviews/${created.meta.id}/comments/comment-1/resolved`, {
      method: 'DELETE'
    });
    await app.request(`/api/reviews/${created.meta.id}/comments/comment-1/resolved`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: 'fixed first comment again' })
    });

    await expect(updates).resolves.toMatchObject([
      {
        type: 'review.updated',
        reviewId: created.meta.id,
        reason: 'review-resolved',
        status: 'resolved',
        resolutionStatus: 'resolved',
        counts: { total: 2, resolved: 2, open: 0 }
      },
      {
        type: 'review.updated',
        reviewId: created.meta.id,
        reason: 'comment-reopened',
        status: 'submitted',
        resolutionStatus: 'partial',
        counts: { total: 2, resolved: 1, open: 1 }
      },
      {
        type: 'review.updated',
        reviewId: created.meta.id,
        reason: 'comment-resolved',
        status: 'resolved',
        resolutionStatus: 'resolved',
        counts: { total: 2, resolved: 2, open: 0 }
      }
    ]);
  });

  it('rejects invalid comment IDs and pending review comment resolution', async () => {
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeApiDiff())
    });
    const created = await responseJson(
      createdResponse,
      isCreateReviewResponse,
      'create review response'
    );

    const pendingResolveResponse = await app.request(
      `/api/reviews/${created.meta.id}/comments/comment-1/resolved`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      }
    );
    expect(pendingResolveResponse.status).toBe(409);

    await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment({ id: 'comment-1' })] })
    });

    const missingResolveResponse = await app.request(
      `/api/reviews/${created.meta.id}/comments/missing-comment/resolved`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      }
    );
    const missingReopenResponse = await app.request(
      `/api/reviews/${created.meta.id}/comments/missing-comment/resolved`,
      { method: 'DELETE' }
    );

    expect(missingResolveResponse.status).toBe(404);
    expect(missingReopenResponse.status).toBe(404);
  });
});

function makeApiDiff() {
  return makeDiff({
    branch: 'raj--gloss--api',
    code: 'export const api = true;',
    cwd: repoRoot,
    filePath: 'api.ts'
  });
}

async function readReviewUpdatedEvents(
  response: Response,
  count: number
): Promise<Array<Extract<ReviewEvent, { type: 'review.updated' }>>> {
  const updates: Array<Extract<ReviewEvent, { type: 'review.updated' }>> = [];
  await readReviewEvents(response, (event) => {
    if (event.type === 'review.updated') {
      updates.push(event);
    }
    return updates.length === count;
  });
  return updates;
}

async function responseJson<T>(response: Response, guard: JsonGuard<T>, label: string): Promise<T> {
  const value: unknown = await response.json();
  return parseJsonValue(value, guard, label);
}

function isErrorResponse(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'error' in value &&
    typeof value.error === 'string'
  );
}

async function readReviewEvents(response: Response, count: number): Promise<ReviewEvent[]>;
async function readReviewEvents(
  response: Response,
  isDone: (event: ReviewEvent) => boolean
): Promise<ReviewEvent[]>;
async function readReviewEvents(
  response: Response,
  countOrIsDone: number | ((event: ReviewEvent) => boolean)
): Promise<ReviewEvent[]> {
  if (!response.body) {
    throw new Error('missing event stream body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: ReviewEvent[] = [];
  const isDone =
    typeof countOrIsDone === 'number'
      ? () => events.length === countOrIsDone
      : (event: ReviewEvent) => countOrIsDone(event);
  let buffer = '';

  try {
    while (true) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) {
        throw new Error('event stream ended before expected events');
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const dataLine = chunk.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) {
          continue;
        }
        const event = parseJson(dataLine.slice(5).trim(), isReviewEvent, 'review event');
        events.push(event);
        if (isDone(event)) {
          return events;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
