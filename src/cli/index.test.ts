import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { execa } from 'execa';
import getPort from 'get-port';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '../shared/json';
import {
  globalReviewMetaFile,
  globalReviewResolvedFile,
  globalStateDir,
  packageVersion
} from '../shared/paths';
import { writeServerInfo } from '../shared/server-info';
import {
  isCreateReviewResponse,
  isListReviewsResponse,
  isOpenResult,
  isResolutionBundle,
  isResolveResult,
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

beforeEach(async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-cli-state-'));
  repoRoot = await mkdtemp(path.join(tmpdir(), 'gloss-cli-repo-'));
  tempDirs = [stateDir, repoRoot];
  process.env.GLOSS_STATE_DIR = stateDir;
  vi.resetModules();
});

afterEach(async () => {
  server?.close();
  server = null;
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

async function initializeGitRepoWithChange(): Promise<void> {
  await execa('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: repoRoot });
  await execa('git', ['config', 'user.email', 'gloss@example.com'], { cwd: repoRoot });
  await execa('git', ['config', 'user.name', 'Gloss Test'], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, 'api.ts'), 'export const api = false;\n');
  await execa('git', ['add', 'api.ts'], { cwd: repoRoot });
  await execa('git', ['commit', '-m', 'initial'], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, 'api.ts'), 'export const api = true;\n');
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
      await readFile(globalReviewResolvedFile(created.meta.id), 'utf8'),
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
      path: globalReviewResolvedFile(created.meta.id)
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
      await readFile(globalReviewResolvedFile(created.meta.id), 'utf8'),
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
      path: globalReviewResolvedFile(created.meta.id)
    });
    expect(meta.status).toBe('submitted');
    expect(resolved).toMatchObject({
      status: 'partial',
      summary: null,
      comments: [{ commentId: 'comment-1', summary: 'fixed one comment' }]
    });
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
});
