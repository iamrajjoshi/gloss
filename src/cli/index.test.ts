import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { execa } from 'execa';
import getPort from 'get-port';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureDir,
  globalReviewMetaFile,
  globalReviewResolvedFile,
  globalServerFile,
  globalStateDir,
  packageVersion
} from '../shared/paths';
import type { Comment, DiffPayload, ReviewMeta, ServerInfo } from '../shared/types';

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
    const created = (await createdResponse.json()) as { meta: ReviewMeta; url: string };

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

    const result = JSON.parse(stdout) as {
      ok: true;
      reviewId: string;
      commentId: string | null;
      summary: string;
      status: string;
      resolutionStatus: string;
      comments: { total: number; resolved: number; open: number };
      path: string;
    };
    const meta = JSON.parse(await readFile(globalReviewMetaFile(created.meta.id), 'utf8')) as {
      status: string;
    };
    const resolved = JSON.parse(
      await readFile(globalReviewResolvedFile(created.meta.id), 'utf8')
    ) as {
      reviewId: string;
      status: string;
      summary: string;
      comments: Array<{ commentId: string }>;
    };

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
    const created = (await createdResponse.json()) as { meta: ReviewMeta; url: string };

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

    const result = JSON.parse(stdout) as {
      ok: true;
      reviewId: string;
      commentId: string;
      summary: string;
      status: string;
      resolutionStatus: string;
      comments: { total: number; resolved: number; open: number };
      path: string;
    };
    const meta = JSON.parse(await readFile(globalReviewMetaFile(created.meta.id), 'utf8')) as {
      status: string;
    };
    const resolved = JSON.parse(
      await readFile(globalReviewResolvedFile(created.meta.id), 'utf8')
    ) as {
      status: string;
      summary: string | null;
      comments: Array<{ commentId: string; summary?: string }>;
    };

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

async function writeServerInfo(info: ServerInfo): Promise<void> {
  await ensureDir(globalStateDir());
  await writeFile(globalServerFile(), `${JSON.stringify(info, null, 2)}\n`);
}

function makeDiff(cwd: string): DiffPayload {
  return {
    base: { ref: 'HEAD', sha: 'abc1234' },
    branch: 'raj--gloss--resolve',
    cwd,
    scope: {
      mode: 'working',
      requestedBase: null,
      base: { ref: 'HEAD', sha: 'abc1234' },
      comparison: { ref: 'working tree', sha: null },
      fallbackReason: null
    },
    stats: { files: 1, additions: 1, deletions: 0 },
    rawDiff: 'diff --git a/resolve.ts b/resolve.ts\n+export const resolved = true;\n',
    files: [
      {
        path: 'resolve.ts',
        oldPath: null,
        additions: 1,
        deletions: 0,
        isBinary: false,
        isDeleted: false,
        isNew: false,
        isRenamed: false,
        language: 'ts',
        hunks: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            header: '@@ -0,0 +1 @@',
            lines: [
              {
                type: 'add',
                oldLine: null,
                newLine: 1,
                content: 'export const resolved = true;'
              }
            ]
          }
        ]
      }
    ],
    capturedAt: '2026-05-23T12:00:00.000Z'
  };
}

function makeComment(id = 'comment-1'): Comment {
  return {
    id,
    filePath: 'resolve.ts',
    startLine: 1,
    endLine: 1,
    side: 'R',
    body: 'Resolve feedback',
    originalSnippet: 'export const resolved = true;',
    createdAt: '2026-05-23T12:00:01.000Z'
  };
}
