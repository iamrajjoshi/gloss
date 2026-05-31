import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { execa } from 'execa';
import getPort from 'get-port';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '../shared/json';
import {
  globalReviewDir,
  globalReviewMetaFile,
  globalReviewsDir,
  globalReviewTurnMetaFile,
  globalReviewTurnResolvedFile,
  globalStateDir,
  packageVersion
} from '../shared/paths';
import { writeServerInfo } from '../shared/server-info';
import type { ReviewMeta, ReviewStatus } from '../shared/types';
import {
  isClearReviewsResult,
  isCreateReviewResponse,
  isListReviewsResponse,
  isOpenResult,
  isResolutionBundle,
  isResolveResult,
  isReviewEvent,
  isReviewRecord,
  isStoredReviewMeta,
  type JsonGuard,
  parseJson,
  parseJsonValue
} from '../shared/validation';
import { makeComment, makeDiff } from '../test/factories';

const originalStateDir = process.env.GLOSS_STATE_DIR;
let tempDirs: string[] = [];
let repoRoot = '';
let server: ReturnType<typeof serve> | null = null;
type TestServer = ReturnType<typeof serve>;

beforeEach(async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-cli-state-'));
  repoRoot = await mkdtemp(path.join(tmpdir(), 'gloss-cli-repo-'));
  tempDirs = [stateDir, repoRoot];
  process.env.GLOSS_STATE_DIR = stateDir;
  vi.resetModules();
});

afterEach(async () => {
  await closeServerFixture();
  if (originalStateDir === undefined) {
    delete process.env.GLOSS_STATE_DIR;
  } else {
    process.env.GLOSS_STATE_DIR = originalStateDir;
  }
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function responseJson<T>(response: Response, guard: JsonGuard<T>, label: string): Promise<T> {
  const value: JsonValue = await response.json();
  return parseJsonValue(value, guard, label);
}

async function startServerFixture(): Promise<{
  app: Awaited<ReturnType<typeof import('../server/index')['createApp']>>;
}> {
  const port = await getPort();
  const { createApp } = await import('../server/index');
  const app = createApp(`http://localhost:${port}`);
  server = serve({ fetch: app.fetch, port });
  await writeServerInfo({
    pid: process.pid,
    port,
    version: packageVersion,
    startedAt: '2026-05-23T12:00:00.000Z',
    stateDir: globalStateDir()
  });
  return { app };
}

async function closeServerFixture(): Promise<void> {
  if (!server) {
    return;
  }
  const current = server;
  server = null;
  await closeServerInstance(current);
}

async function closeServerInstance(current: TestServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    current.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function initializeGitRepoWithChange(): Promise<void> {
  await execa('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: repoRoot });
  await execa('git', ['config', 'user.email', 'gloss@example.com'], { cwd: repoRoot });
  await execa('git', ['config', 'user.name', 'Gloss Test'], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, 'api.ts'), 'export const api = false;\n');
  await execa('git', ['add', 'api.ts'], { cwd: repoRoot });
  await execa('git', ['commit', '-m', 'initial'], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, 'api.ts'), 'export const api = true;\n');
}

async function writeClearReviewMeta(reviewId: string, status: ReviewStatus): Promise<void> {
  await mkdir(globalReviewDir(reviewId), { recursive: true });
  const meta: ReviewMeta = {
    id: reviewId,
    cwd: repoRoot,
    base: { ref: 'HEAD', sha: '1234567890abcdef1234567890abcdef12345678' },
    branch: null,
    status,
    createdAt: '2000-01-01T00:00:00.000Z',
    submittedAt: status === 'submitted' ? '2000-01-02T00:00:00.000Z' : undefined,
    resolvedAt: status === 'resolved' ? '2000-01-03T00:00:00.000Z' : undefined,
    artifactDir: globalReviewDir(reviewId)
  };
  await writeFile(globalReviewMetaFile(reviewId), `${JSON.stringify(meta, null, 2)}\n`);
  await writeFile(path.join(globalReviewDir(reviewId), 'artifact.txt'), 'review artifact\n');
}

async function agePersistedTurn(reviewId: string, turnId: string): Promise<void> {
  if (!turnId) {
    throw new Error('missing turn id');
  }
  const turnPath = globalReviewTurnMetaFile(reviewId, turnId);
  const turn = JSON.parse(await readFile(turnPath, 'utf8'));
  await writeFile(
    turnPath,
    `${JSON.stringify(
      {
        ...turn,
        status: 'submitted',
        createdAt: '2000-01-01T00:00:00.000Z',
        submittedAt: '2000-01-02T00:00:00.000Z',
        resolvedAt: undefined
      },
      null,
      2
    )}\n`
  );
}

function runCliInRepo(args: string[], options: { reject?: boolean } = {}) {
  return execa(process.execPath, ['--import', tsxLoaderPath(), cliPath(), ...args], {
    cwd: repoRoot,
    reject: options.reject,
    env: {
      ...process.env,
      GLOSS_STATE_DIR: process.env.GLOSS_STATE_DIR
    }
  });
}

function cliPath(): string {
  return path.resolve('src/cli/index.ts');
}

function tsxLoaderPath(): string {
  return path.resolve('node_modules/tsx/dist/loader.mjs');
}

describe('gloss resolve', () => {
  it('marks a review resolved and prints JSON output', async () => {
    const port = await getPort();
    const { createApp } = await import('../server/index');
    const app = createApp(`http://localhost:${port}`);

    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeDiff(repoRoot))
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

    server = serve({ fetch: app.fetch, port });
    await writeServerInfo({
      pid: process.pid,
      port,
      version: packageVersion,
      startedAt: '2026-05-23T12:00:00.000Z',
      stateDir: globalStateDir()
    });

    const { stdout } = await execa(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/cli/index.ts',
        'resolve',
        created.meta.id,
        '--summary',
        'fixed from cli',
        '--json'
      ],
      {
        cwd: path.resolve('.'),
        env: {
          ...process.env,
          GLOSS_STATE_DIR: process.env.GLOSS_STATE_DIR
        }
      }
    );

    const result = parseJson(stdout, isResolveResult, 'resolve command output');
    const meta = parseJson(
      await readFile(globalReviewMetaFile(created.meta.id), 'utf8'),
      isStoredReviewMeta,
      'review metadata'
    );
    const resolved = parseJson(
      await readFile(result.path, 'utf8'),
      isResolutionBundle,
      'review resolution'
    );

    expect(result).toMatchObject({
      ok: true,
      reviewId: created.meta.id,
      commentId: null,
      summary: 'fixed from cli',
      status: 'resolved',
      resolutionStatus: 'resolved',
      comments: { total: 1, resolved: 1, open: 0 },
      path: globalReviewTurnResolvedFile(created.meta.id, created.turn?.id ?? '')
    });
    expect(meta.status).toBe('resolved');
    expect(resolved).toMatchObject({
      reviewId: created.meta.id,
      status: 'resolved',
      summary: 'fixed from cli',
      comments: [{ commentId: 'comment-1' }]
    });
  });

  it('marks one submitted comment resolved and prints JSON output', async () => {
    const port = await getPort();
    const { createApp } = await import('../server/index');
    const app = createApp(`http://localhost:${port}`);

    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeDiff(repoRoot))
    });
    const created = await responseJson(
      createdResponse,
      isCreateReviewResponse,
      'create review response'
    );

    await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment('comment-1'), makeComment('comment-2')] })
    });

    server = serve({ fetch: app.fetch, port });
    await writeServerInfo({
      pid: process.pid,
      port,
      version: packageVersion,
      startedAt: '2026-05-23T12:00:00.000Z',
      stateDir: globalStateDir()
    });

    const { stdout } = await execa(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/cli/index.ts',
        'resolve',
        created.meta.id,
        '--comment',
        'comment-1',
        '--summary',
        'fixed one comment',
        '--json'
      ],
      {
        cwd: path.resolve('.'),
        env: {
          ...process.env,
          GLOSS_STATE_DIR: process.env.GLOSS_STATE_DIR
        }
      }
    );

    const result = parseJson(stdout, isResolveResult, 'resolve command output');
    const meta = parseJson(
      await readFile(globalReviewMetaFile(created.meta.id), 'utf8'),
      isStoredReviewMeta,
      'review metadata'
    );
    const resolved = parseJson(
      await readFile(result.path, 'utf8'),
      isResolutionBundle,
      'review resolution'
    );

    expect(result).toMatchObject({
      ok: true,
      reviewId: created.meta.id,
      commentId: 'comment-1',
      summary: 'fixed one comment',
      status: 'submitted',
      resolutionStatus: 'partial',
      comments: { total: 2, resolved: 1, open: 1 },
      path: globalReviewTurnResolvedFile(created.meta.id, created.turn?.id ?? '')
    });
    expect(meta.status).toBe('submitted');
    expect(resolved).toMatchObject({
      status: 'partial',
      summary: null,
      comments: [{ commentId: 'comment-1', summary: 'fixed one comment' }]
    });
  });
});

describe('gloss clear', () => {
  it('prints zero-deletion plain output when no review artifacts exist', async () => {
    const { stdout } = await runCliInRepo(['clear']);

    expect(stdout.trim()).toBe(
      `Deleted 0 review artifact(s) older than 30 day(s) from ${globalReviewsDir()}`
    );
  });

  it('deletes old completed review artifacts and prints JSON output', async () => {
    await writeClearReviewMeta('old-submitted', 'submitted');

    const { stdout } = await runCliInRepo(['clear', '--json']);
    const result = parseJson(stdout, isClearReviewsResult, 'clear command output');

    expect(result.olderThanDays).toBe(30);
    expect(result.deleted.map((review) => review.reviewId)).toEqual(['old-submitted']);
    expect(result.counts).toEqual({ candidates: 1, deleted: 1, skipped: 0 });
    expect(existsSync(globalReviewDir('old-submitted'))).toBe(false);
  });

  it('prints dry-run candidates without deleting artifacts', async () => {
    await writeClearReviewMeta('old-resolved', 'resolved');

    const { stdout } = await runCliInRepo(['clear', '--dry-run', '--older-than', '30']);

    expect(stdout.trim()).toBe(
      `Would delete 1 review artifact(s) older than 30 day(s) from ${globalReviewsDir()}`
    );
    expect(existsSync(globalReviewDir('old-resolved'))).toBe(true);
  });

  it('uses the running daemon so cleared reviews leave server memory', async () => {
    const { app } = await startServerFixture();
    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeDiff(repoRoot))
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
    await writeClearReviewMeta(created.meta.id, 'submitted');
    await agePersistedTurn(created.meta.id, created.turn?.id ?? '');

    const { stdout } = await runCliInRepo(['clear', '--json']);
    const result = parseJson(stdout, isClearReviewsResult, 'clear command output');
    const listResponse = await app.request('/api/reviews');
    const list = await responseJson(listResponse, isListReviewsResponse, 'review list response');

    expect(result.deleted.map((review) => review.reviewId)).toEqual([created.meta.id]);
    expect(list.reviews).toEqual([]);
  });
});

describe('gloss open', () => {
  it('leaves the review pending when watch times out', async () => {
    await initializeGitRepoWithChange();
    const { app } = await startServerFixture();

    const result = await runCliInRepo(['open', '--no-open', '--timeout', '0.2', '--json'], {
      reject: false
    });
    const listResponse = await app.request('/api/reviews');
    const list = await responseJson(listResponse, isListReviewsResponse, 'review list response');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('watch timed out after 0.2 seconds');
    expect(list.reviews).toHaveLength(1);
    expect(list.reviews[0]?.status).toBe('pending');
  });

  it('leaves the review pending when opened with --no-watch', async () => {
    await initializeGitRepoWithChange();
    const { app } = await startServerFixture();

    const { stdout } = await runCliInRepo(['open', '--no-open', '--no-watch', '--json']);
    const output = parseJson(stdout, isOpenResult, 'open command output');
    const listResponse = await app.request('/api/reviews');
    const list = await responseJson(listResponse, isListReviewsResponse, 'review list response');

    expect(output.reviewId).toBe(list.reviews[0]?.id);
    expect(list.reviews).toHaveLength(1);
    expect(list.reviews[0]?.status).toBe('pending');
  });

  it('supports repeated agent-code human-review turns with --review', async () => {
    await initializeGitRepoWithChange();
    const { app } = await startServerFixture();

    const first = parseJson(
      (await runCliInRepo(['open', '--base', 'HEAD', '--no-open', '--no-watch', '--json'])).stdout,
      isOpenResult,
      'first open output'
    );
    const firstSubmitResponse = await app.request(`/api/reviews/${first.reviewId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment({ id: 'comment-1', filePath: 'api.ts' })] })
    });
    const firstSubmit = await responseJson(
      firstSubmitResponse,
      isOpenResult,
      'first submit response'
    );
    await writeFile(path.join(repoRoot, 'api.ts'), 'export const api = "followup";\n');

    const second = parseJson(
      (
        await runCliInRepo([
          'open',
          '--review',
          first.reviewId,
          '--no-open',
          '--no-watch',
          '--json'
        ])
      ).stdout,
      isOpenResult,
      'second open output'
    );
    const openedResponse = await app.request(`/api/reviews/${first.reviewId}`);
    const opened = await responseJson(openedResponse, isReviewRecord, 'opened review response');
    const secondSubmitResponse = await app.request(`/api/reviews/${first.reviewId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        comments: [
          makeComment({
            id: 'comment-2',
            filePath: 'api.ts',
            body: 'Follow-up feedback.',
            originalSnippet: 'export const api = "followup";'
          })
        ]
      })
    });
    const secondSubmit = await responseJson(
      secondSubmitResponse,
      isOpenResult,
      'second submit response'
    );
    const submittedResponse = await app.request(`/api/reviews/${first.reviewId}`);
    const submitted = await responseJson(
      submittedResponse,
      isReviewRecord,
      'submitted review response'
    );

    expect(second.reviewId).toBe(first.reviewId);
    expect(second.turnIndex).toBe(2);
    expect(second.turnId).not.toBe(first.turnId);
    expect(opened.turns).toHaveLength(2);
    expect(opened.meta.activeTurnId).toBe(second.turnId);
    expect(opened.diff.rawDiff).toContain('followup');
    expect(opened.diff.scope.mode).toBe('explicit');
    expect(opened.diff.scope.requestedBase).toBe('HEAD');
    expect(firstSubmit.turnId).toBe(first.turnId);
    expect(secondSubmit.turnId).toBe(second.turnId);
    expect(submitted.meta.status).toBe('submitted');
    expect(submitted.turns.map((turn) => turn.feedback?.comments[0]?.id)).toEqual([
      'comment-1',
      'comment-2'
    ]);
    expect(submitted.meta.turns?.map((turn) => turn.comments.total)).toEqual([1, 1]);
  });
});

describe('gloss watch', () => {
  it('reconnects when the daemon restarts on another port', async () => {
    let markStreamOpened: (() => void) | null = null;
    const firstStream: { close: (() => void) | null } = { close: null };
    const streamOpened = new Promise<void>((resolve) => {
      markStreamOpened = resolve;
    });
    const firstPort = await getPort();
    const { createApp } = await import('../server/index');
    const app = createApp(`http://localhost:${firstPort}`, {
      registerEventStream: (close) => {
        firstStream.close = close;
        queueMicrotask(() => markStreamOpened?.());
        return () => {
          if (firstStream.close === close) {
            firstStream.close = null;
          }
        };
      }
    });
    server = serve({ fetch: app.fetch, port: firstPort });
    await writeServerInfo({
      pid: process.pid,
      port: firstPort,
      version: packageVersion,
      startedAt: '2026-05-23T12:00:00.000Z',
      stateDir: globalStateDir()
    });
    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeDiff(repoRoot))
    });
    const created = await responseJson(
      createdResponse,
      isCreateReviewResponse,
      'create review response'
    );

    const watch = runCliInRepo(['watch', created.meta.id, '--timeout', '5', '--json']);
    await streamOpened;
    const firstServer = server;
    if (!firstServer) {
      throw new Error('expected first server fixture');
    }
    const secondPort = await getPort();
    server = serve({ fetch: app.fetch, port: secondPort });
    await writeServerInfo({
      pid: process.pid,
      port: secondPort,
      version: packageVersion,
      startedAt: '2026-05-23T12:00:01.000Z',
      stateDir: globalStateDir()
    });
    firstStream.close?.();
    await closeServerInstance(firstServer);
    const submittedResponse = await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment()] })
    });
    await responseJson(submittedResponse, isOpenResult, 'submit review response');

    const event = parseJson((await watch).stdout, isReviewEvent, 'watch output');

    expect(event).toMatchObject({
      type: 'review.submitted',
      reviewId: created.meta.id,
      turnId: created.turn?.id
    });
  }, 10_000);
});
