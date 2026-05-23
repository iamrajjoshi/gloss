import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globalReviewDir, globalReviewFeedbackFile } from '../shared/paths';
import type { Comment, DiffPayload, OpenResult, ReviewMeta } from '../shared/types';

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
    const diff = makeDiff(repoRoot);

    const createdResponse = await app.request('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(diff)
    });
    const created = (await createdResponse.json()) as {
      meta: ReviewMeta;
      url: string;
    };

    expect(createdResponse.status).toBe(201);
    expect(created.url).toBe(`http://localhost:4321/review/${created.meta.id}`);
    expect(created.meta.artifactDir).toBe(globalReviewDir(created.meta.id));
    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);

    const submittedResponse = await app.request(`/api/reviews/${created.meta.id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comments: [makeComment()] })
    });
    const submitted = (await submittedResponse.json()) as OpenResult;

    expect(submitted.artifactDir).toBe(globalReviewDir(created.meta.id));
    expect(submitted.feedbackPath).toBe(globalReviewFeedbackFile(created.meta.id));

    vi.resetModules();
    const { createApp: createReloadedApp } = await import('./index');
    const reloadedApp = createReloadedApp('http://localhost:4321');
    const listResponse = await reloadedApp.request('/api/reviews');
    const list = (await listResponse.json()) as { reviews: ReviewMeta[] };
    const eventsResponse = await reloadedApp.request(`/api/reviews/${created.meta.id}/events`);
    const eventsText = await eventsResponse.text();

    expect(list.reviews.map((review) => review.id)).toEqual([created.meta.id]);
    expect(list.reviews[0]?.status).toBe('completed');
    expect(eventsText).toContain('"type":"review.completed"');
    expect(eventsText).toContain(`"reviewId":"${created.meta.id}"`);
  });
});

function makeDiff(cwd: string): DiffPayload {
  return {
    base: { ref: 'HEAD', sha: 'abc1234' },
    branch: 'raj--gloss--api',
    cwd,
    scope: {
      mode: 'working',
      requestedBase: null,
      base: { ref: 'HEAD', sha: 'abc1234' },
      comparison: { ref: 'working tree', sha: null },
      fallbackReason: null
    },
    stats: { files: 1, additions: 1, deletions: 0 },
    rawDiff: 'diff --git a/api.ts b/api.ts\n+export const api = true;\n',
    files: [
      {
        path: 'api.ts',
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
                content: 'export const api = true;'
              }
            ]
          }
        ]
      }
    ],
    capturedAt: '2026-05-22T12:00:00.000Z'
  };
}

function makeComment(): Comment {
  return {
    id: 'comment-1',
    filePath: 'api.ts',
    startLine: 1,
    endLine: 1,
    side: 'R',
    body: 'API feedback',
    originalSnippet: 'export const api = true;',
    createdAt: '2026-05-22T12:00:01.000Z'
  };
}
