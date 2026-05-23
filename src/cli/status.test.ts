import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReviewStore } from '../server/store';
import type { Comment, DiffPayload, ServerInfo } from '../shared/types';
import { listReviewsForStatus } from './status';

const originalStateDir = process.env.GLOSS_STATE_DIR;
let tempDirs: string[] = [];
let repoRoot = '';

beforeEach(async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-status-state-'));
  repoRoot = await mkdtemp(path.join(tmpdir(), 'gloss-status-repo-'));
  tempDirs = [stateDir, repoRoot];
  process.env.GLOSS_STATE_DIR = stateDir;
});

afterEach(async () => {
  if (originalStateDir === undefined) {
    delete process.env.GLOSS_STATE_DIR;
  } else {
    process.env.GLOSS_STATE_DIR = originalStateDir;
  }
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('listReviewsForStatus', () => {
  it('loads global reviews when the daemon is not responsive', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeDiff(repoRoot));
    await store.submit(record.meta.id, [makeComment()]);
    await store.markResolved(record.meta.id, 'done');

    const staleServer: ServerInfo = {
      pid: -1,
      port: 9,
      version: '0.0.0',
      startedAt: '2026-05-22T12:00:00.000Z',
      stateDir: process.env.GLOSS_STATE_DIR ?? ''
    };

    const reviews = await listReviewsForStatus({ responsive: false, server: staleServer });

    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      id: record.meta.id,
      status: 'resolved',
      cwd: repoRoot
    });
    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);
  });
});

function makeDiff(cwd: string): DiffPayload {
  return {
    base: { ref: 'HEAD', sha: 'abc1234' },
    branch: 'raj--gloss--status',
    cwd,
    scope: {
      mode: 'working',
      requestedBase: null,
      base: { ref: 'HEAD', sha: 'abc1234' },
      comparison: { ref: 'working tree', sha: null },
      fallbackReason: null
    },
    stats: { files: 1, additions: 1, deletions: 0 },
    rawDiff: 'diff --git a/status.ts b/status.ts\n+export const status = true;\n',
    files: [
      {
        path: 'status.ts',
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
                content: 'export const status = true;'
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
    filePath: 'status.ts',
    startLine: 1,
    endLine: 1,
    side: 'R',
    body: 'Use the durable status store.',
    originalSnippet: 'export const status = true;',
    createdAt: '2026-05-22T12:00:01.000Z'
  };
}
