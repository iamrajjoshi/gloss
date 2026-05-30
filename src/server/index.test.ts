import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '../shared/json';
import {
  globalReviewDir,
  globalReviewTurnFeedbackFile,
  globalReviewTurnResolvedFile
} from '../shared/paths';
import type { ReviewEvent } from '../shared/types';
import {
  isCommitRangeDiffResponse,
  isCreateReviewResponse,
  isCreateReviewTurnResponse,
  isListReviewsResponse,
  isOpenFileResponse,
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
  vi.doUnmock('./local-open');
  vi.doUnmock('../cli/git');
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
    expect(created.turn).toBeTruthy();
    expect(created.url).toBe(`http://localhost:4321/review/${created.meta.id}`);
    expect(created.meta.artifactDir).toBe(globalReviewDir(created.meta.id));
    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);

    const submittedResponse = await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment()] })
    });
    const submitted = await responseJson(submittedResponse, isOpenResult, 'submit review response');

    expect(submitted.turnId).toBe(created.turn?.id);
    expect(submitted.artifactDir).toBe(created.turn?.artifactDir);
    expect(submitted.feedbackPath).toBe(
      globalReviewTurnFeedbackFile(created.meta.id, created.turn?.id ?? '')
    );

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

  it('treats identical resubmits as idempotent and rejects changed resubmits', async () => {
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
    const changedSubmitResponse = await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment({ body: 'Different feedback.' })] })
    });

    expect(firstSubmitResponse.status).toBe(200);
    expect(submittedAgainResponse.status).toBe(200);
    expect(changedSubmitResponse.status).toBe(409);

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

    expect(resolvedSubmitResponse.status).toBe(200);
  });

  it('persists submitted feedback scope from the UI commit selection', async () => {
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    const diff = makeApiDiffWithCommits();
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
    const reviewScope = {
      mode: 'single' as const,
      sha: diff.commitDiffs?.[1]?.commit.sha ?? ''
    };

    const submittedResponse = await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reviewScope,
        comments: [makeComment({ filePath: 'second.ts', originalSnippet: 'second' })]
      })
    });
    const changedScopeResponse = await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reviewScope: { mode: 'all' },
        comments: [makeComment({ filePath: 'second.ts', originalSnippet: 'second' })]
      })
    });
    const hydratedResponse = await app.request(`/api/reviews/${created.meta.id}`);
    const hydrated = await responseJson(hydratedResponse, isReviewRecord, 'review response');

    expect(submittedResponse.status).toBe(200);
    expect(changedScopeResponse.status).toBe(409);
    expect(hydrated.feedback?.reviewScope).toEqual(reviewScope);
    expect(hydrated.turns[0]?.feedback?.reviewScope).toEqual(reviewScope);
  });

  it('appends and reuses turns through the API', async () => {
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
      body: JSON.stringify({ comments: [makeComment({ id: 'comment-1' })] })
    });

    const secondDiff = makeApiDiff({
      code: 'export const followup = true;',
      filePath: 'followup.ts'
    });
    const appendedResponse = await app.request(`/api/reviews/${created.meta.id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(secondDiff)
    });
    const appended = await responseJson(
      appendedResponse,
      isCreateReviewTurnResponse,
      'create turn response'
    );
    const retriedResponse = await app.request(`/api/reviews/${created.meta.id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(secondDiff)
    });
    const retried = await responseJson(
      retriedResponse,
      isCreateReviewTurnResponse,
      'retry turn response'
    );
    const hydratedResponse = await app.request(`/api/reviews/${created.meta.id}`);
    const hydrated = await responseJson(hydratedResponse, isReviewRecord, 'review response');

    expect(appendedResponse.status).toBe(200);
    expect(appended.reused).toBe(false);
    expect(appended.turn.index).toBe(2);
    expect(retried.reused).toBe(true);
    expect(retried.turn.id).toBe(appended.turn.id);
    expect(hydrated.turns).toHaveLength(2);
    expect(hydrated.meta.activeTurnId).toBe(appended.turn.id);
    expect(hydrated.diff.files[0]?.path).toBe('followup.ts');
  });

  it('accepts and reloads review payloads with per-commit diffs', async () => {
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    const diff = makeApiDiff();
    diff.commitDiffs = [
      {
        commit: {
          sha: '1234567890abcdef1234567890abcdef12345678',
          shortSha: '1234567',
          subject: 'add api file',
          authorName: 'Gloss Test',
          authorEmail: 'gloss@example.com',
          authoredAt: '2026-05-22T12:00:00.000Z',
          committedAt: '2026-05-22T12:00:01.000Z'
        },
        stats: diff.stats,
        rawDiff: diff.rawDiff,
        files: diff.files
      }
    ];

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
    const hydratedResponse = await app.request(`/api/reviews/${created.meta.id}`);
    const hydrated = await responseJson(hydratedResponse, isReviewRecord, 'review response');

    expect(createdResponse.status).toBe(201);
    expect(hydrated.diff.commitDiffs?.[0]?.commit.subject).toBe('add api file');
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

  it('opens changed files locally after validating the review path', async () => {
    const openLocalPath = vi.fn(async (_filePath: string) => undefined);
    vi.doMock('./local-open', () => ({ openLocalPath }));
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    await writeFile(path.join(repoRoot, 'api.ts'), 'export const api = true;\n');
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

    const openResponse = await app.request(`/api/reviews/${created.meta.id}/files/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: 'api.ts' })
    });
    const opened = await responseJson(openResponse, isOpenFileResponse, 'open file response');
    const expectedPath = await realpath(path.join(repoRoot, 'api.ts'));

    expect(openResponse.status).toBe(200);
    expect(opened).toEqual({ ok: true, path: expectedPath });
    expect(openLocalPath).toHaveBeenCalledWith(expectedPath);
  });

  it('returns a combined diff for a valid commit range', async () => {
    const captureCommitRangeDiff = vi.fn(async (_fromSha: string, _toSha: string) => ({
      stats: { files: 2, additions: 2, deletions: 0 },
      rawDiff: 'diff --git a/api.ts b/api.ts\n',
      files: [makeApiDiff().files[0], { ...makeApiDiff().files[0], path: 'second.ts' }]
    }));
    vi.doMock('../shared/git-diff', () => ({ captureCommitRangeDiff }));
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    const diff = makeApiDiffWithCommits();
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

    const rangeResponse = await app.request(`/api/reviews/${created.meta.id}/commits/range`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromSha: diff.commitDiffs?.[0]?.commit.sha,
        toSha: diff.commitDiffs?.[1]?.commit.sha
      })
    });
    const range = await responseJson(
      rangeResponse,
      isCommitRangeDiffResponse,
      'commit range diff response'
    );

    expect(rangeResponse.status).toBe(200);
    expect(range.stats).toEqual({ files: 2, additions: 2, deletions: 0 });
    expect(range.files.map((file) => file.path)).toEqual(['api.ts', 'second.ts']);
    expect(captureCommitRangeDiff).toHaveBeenCalledWith(
      diff.commitDiffs?.[0]?.commit.sha,
      diff.commitDiffs?.[1]?.commit.sha,
      repoRoot
    );
  });

  it('rejects invalid commit range requests', async () => {
    const captureCommitRangeDiff = vi.fn();
    vi.doMock('../shared/git-diff', () => ({ captureCommitRangeDiff }));
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    const noCommitsCreatedResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeApiDiff())
    });
    const noCommitsCreated = await responseJson(
      noCommitsCreatedResponse,
      isCreateReviewResponse,
      'create review response'
    );
    const diff = makeApiDiffWithCommits();
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

    const unavailableResponse = await app.request(
      `/api/reviews/${noCommitsCreated.meta.id}/commits/range`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromSha: 'missing', toSha: 'missing' })
      }
    );
    const unknownResponse = await app.request(`/api/reviews/${created.meta.id}/commits/range`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromSha: 'missing', toSha: diff.commitDiffs?.[1]?.commit.sha })
    });
    const reversedResponse = await app.request(`/api/reviews/${created.meta.id}/commits/range`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromSha: diff.commitDiffs?.[1]?.commit.sha,
        toSha: diff.commitDiffs?.[0]?.commit.sha
      })
    });

    expect(unavailableResponse.status).toBe(409);
    expect(unknownResponse.status).toBe(404);
    expect(reversedResponse.status).toBe(400);
    expect(captureCommitRangeDiff).not.toHaveBeenCalled();
  });

  it('opens files that are present only in per-commit diffs', async () => {
    const openLocalPath = vi.fn(async (_filePath: string) => undefined);
    vi.doMock('./local-open', () => ({ openLocalPath }));
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321');
    await writeFile(path.join(repoRoot, 'api.ts'), 'export const api = true;\n');
    const diff = makeApiDiff();
    const commitFiles = diff.files;
    diff.files = [];
    diff.stats = { files: 0, additions: 0, deletions: 0 };
    diff.commitDiffs = [
      {
        commit: {
          sha: '1234567890abcdef1234567890abcdef12345678',
          shortSha: '1234567',
          subject: 'add api file',
          authorName: 'Gloss Test',
          authorEmail: 'gloss@example.com',
          authoredAt: '2026-05-22T12:00:00.000Z',
          committedAt: '2026-05-22T12:00:01.000Z'
        },
        stats: { files: 1, additions: 1, deletions: 0 },
        rawDiff: diff.rawDiff,
        files: commitFiles
      }
    ];
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

    const openResponse = await app.request(`/api/reviews/${created.meta.id}/files/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: 'api.ts' })
    });

    expect(openResponse.status).toBe(200);
    expect(openLocalPath).toHaveBeenCalledWith(await realpath(path.join(repoRoot, 'api.ts')));
  });

  it('rejects invalid local file open requests', async () => {
    const openLocalPath = vi.fn(async (_filePath: string) => undefined);
    vi.doMock('./local-open', () => ({ openLocalPath }));
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

    const traversalResponse = await app.request(`/api/reviews/${created.meta.id}/files/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: '../api.ts' })
    });
    const missingResponse = await app.request(`/api/reviews/${created.meta.id}/files/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: 'api.ts' })
    });
    const notReviewedResponse = await app.request(`/api/reviews/${created.meta.id}/files/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: 'other.ts' })
    });
    const deletedDiff = makeApiDiff();
    deletedDiff.files[0].isDeleted = true;
    const deletedCreatedResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(deletedDiff)
    });
    const deletedCreated = await responseJson(
      deletedCreatedResponse,
      isCreateReviewResponse,
      'create review response'
    );
    const deletedResponse = await app.request(`/api/reviews/${deletedCreated.meta.id}/files/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: 'api.ts' })
    });

    expect(traversalResponse.status).toBe(400);
    expect(missingResponse.status).toBe(404);
    expect(notReviewedResponse.status).toBe(404);
    expect(deletedResponse.status).toBe(409);
    expect(openLocalPath).not.toHaveBeenCalled();
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
      path: globalReviewTurnResolvedFile(created.meta.id, created.turn?.id ?? '')
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

  it('notifies the daemon idle scheduler after review state changes', async () => {
    const onReviewActivity = vi.fn();
    const { createApp } = await import('./index');
    const app = createApp('http://localhost:4321', { onReviewActivity });
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
    await app.request(`/api/reviews/${created.meta.id}/resolved`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: 'done' })
    });

    expect(onReviewActivity).toHaveBeenCalledTimes(3);
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

function makeApiDiff(options: { code?: string; filePath?: string } = {}) {
  return makeDiff({
    branch: 'raj--gloss--api',
    code: options.code ?? 'export const api = true;',
    cwd: repoRoot,
    filePath: options.filePath ?? 'api.ts'
  });
}

function makeApiDiffWithCommits() {
  const first = makeApiDiff();
  const second = makeDiff({
    branch: 'raj--gloss--api',
    code: 'export const second = true;',
    cwd: repoRoot,
    filePath: 'second.ts'
  });
  first.commitDiffs = [
    {
      commit: {
        sha: '1234567890abcdef1234567890abcdef12345678',
        shortSha: '1234567',
        subject: 'add api file',
        authorName: 'Gloss Test',
        authorEmail: 'gloss@example.com',
        authoredAt: '2026-05-22T12:00:00.000Z',
        committedAt: '2026-05-22T12:00:01.000Z'
      },
      stats: first.stats,
      rawDiff: first.rawDiff,
      files: first.files
    },
    {
      commit: {
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        shortSha: 'abcdef1',
        subject: 'add second file',
        authorName: 'Gloss Test',
        authorEmail: 'gloss@example.com',
        authoredAt: '2026-05-22T12:01:00.000Z',
        committedAt: '2026-05-22T12:01:01.000Z'
      },
      stats: second.stats,
      rawDiff: second.rawDiff,
      files: second.files
    }
  ];
  return first;
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
  const value: JsonValue = await response.json();
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
