import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  globalReviewFeedbackFile,
  globalReviewMarkdownFile,
  globalReviewResolvedFile
} from '../shared/paths';
import type { Comment, DiffPayload } from '../shared/types';
import { ReviewStore } from './store';

const originalStateDir = process.env.GLOSS_STATE_DIR;
let tempDirs: string[] = [];
let repoRoot = '';

beforeEach(async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-state-'));
  repoRoot = await mkdtemp(path.join(tmpdir(), 'gloss-repo-'));
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

describe('ReviewStore global persistence', () => {
  it('stores reviews globally without writing repo-local artifacts', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeDiff(repoRoot));

    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);
    expect(existsSync(record.meta.artifactDir)).toBe(true);

    const {
      record: completed,
      feedbackPath,
      markdownPath
    } = await store.submit(record.meta.id, [makeComment()]);

    expect(completed.meta.status).toBe('completed');
    expect(completed.meta.feedbackPath).toBe(feedbackPath);
    expect(completed.meta.markdownPath).toBe(markdownPath);
    expect(feedbackPath).toBe(globalReviewFeedbackFile(record.meta.id));
    expect(markdownPath).toBe(globalReviewMarkdownFile(record.meta.id));
    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);

    const reloaded = new ReviewStore();
    const reviews = await reloaded.list();
    const loaded = await reloaded.get(record.meta.id);

    expect(reviews).toHaveLength(1);
    expect(loaded?.meta.status).toBe('completed');
    expect(loaded?.feedback?.comments).toHaveLength(1);
    expect(await reloaded.feedback(record.meta.id)).toEqual(loaded?.feedback);

    const resolvedPath = await reloaded.markResolved(record.meta.id, 'fixed locally');
    const resolved = await reloaded.get(record.meta.id);
    const resolvedPayload = JSON.parse(await readFile(resolvedPath, 'utf8')) as {
      summary: string;
    };

    expect(resolvedPath).toBe(globalReviewResolvedFile(record.meta.id));
    expect(resolved?.meta.status).toBe('resolved');
    expect(resolvedPayload.summary).toBe('fixed locally');
    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);
  });

  it('reloads pending reviews from the global store', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeDiff(repoRoot));

    const reloaded = new ReviewStore();
    const loaded = await reloaded.get(record.meta.id);

    expect(loaded?.meta.status).toBe('pending');
    expect(loaded?.diff.cwd).toBe(repoRoot);
    expect(await reloaded.list()).toHaveLength(1);
  });
});

function makeDiff(cwd: string): DiffPayload {
  return {
    base: { ref: 'HEAD', sha: 'abc1234' },
    branch: 'raj--gloss--global-store',
    cwd,
    scope: {
      mode: 'working',
      requestedBase: null,
      base: { ref: 'HEAD', sha: 'abc1234' },
      comparison: { ref: 'working tree', sha: null },
      fallbackReason: null
    },
    stats: { files: 1, additions: 1, deletions: 0 },
    rawDiff: 'diff --git a/app.ts b/app.ts\n+export const value = 1;\n',
    files: [
      {
        path: 'app.ts',
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
                content: 'export const value = 1;'
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
    filePath: 'app.ts',
    startLine: 1,
    endLine: 1,
    side: 'R',
    body: 'Looks good.',
    originalSnippet: 'export const value = 1;',
    createdAt: '2026-05-22T12:00:01.000Z'
  };
}
