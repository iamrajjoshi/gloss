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
      record: submitted,
      feedbackPath,
      markdownPath
    } = await store.submit(record.meta.id, [makeComment()]);

    expect(submitted.meta.status).toBe('submitted');
    expect(submitted.meta.submittedAt).toBeTruthy();
    expect(submitted.meta.feedbackPath).toBe(feedbackPath);
    expect(submitted.meta.markdownPath).toBe(markdownPath);
    expect(feedbackPath).toBe(globalReviewFeedbackFile(record.meta.id));
    expect(markdownPath).toBe(globalReviewMarkdownFile(record.meta.id));
    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);

    const reloaded = new ReviewStore();
    const reviews = await reloaded.list();
    const loaded = await reloaded.get(record.meta.id);

    expect(reviews).toHaveLength(1);
    expect(loaded?.meta.status).toBe('submitted');
    expect(loaded?.feedback?.comments).toHaveLength(1);
    expect(await reloaded.feedback(record.meta.id)).toEqual(loaded?.feedback);

    const result = await reloaded.markResolved(record.meta.id, 'fixed locally');
    const resolvedPath = result.path;
    const resolved = await reloaded.get(record.meta.id);
    const resolvedPayload = JSON.parse(await readFile(resolvedPath, 'utf8')) as {
      status: string;
      summary: string;
      comments: Array<{ commentId: string; status: string }>;
    };

    expect(resolvedPath).toBe(globalReviewResolvedFile(record.meta.id));
    expect(resolved?.meta.status).toBe('resolved');
    expect(resolved?.resolution).toEqual(resolvedPayload);
    expect(resolvedPayload).toMatchObject({
      reviewId: record.meta.id,
      status: 'resolved',
      summary: 'fixed locally',
      comments: [{ commentId: 'comment-1', status: 'resolved' }]
    });
    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);
  });

  it('tracks comment-level resolution progress separately from submitted feedback', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeDiff(repoRoot));
    await store.submit(record.meta.id, [makeComment('comment-1'), makeComment('comment-2')]);

    const partial = await store.resolveComment(record.meta.id, 'comment-1', 'fixed first item');
    const partiallyResolved = await store.get(record.meta.id);
    const partialPayload = JSON.parse(await readFile(partial.path, 'utf8')) as {
      status: string;
      summary: string | null;
      comments: Array<{ commentId: string; summary?: string }>;
    };

    expect(partial).toMatchObject({
      status: 'submitted',
      resolutionStatus: 'partial',
      comments: { total: 2, resolved: 1, open: 1 },
      path: globalReviewResolvedFile(record.meta.id)
    });
    expect(partiallyResolved?.meta.status).toBe('submitted');
    expect(partiallyResolved?.feedback?.comments).toHaveLength(2);
    expect(partialPayload).toMatchObject({
      reviewId: record.meta.id,
      status: 'partial',
      summary: null,
      comments: [{ commentId: 'comment-1', summary: 'fixed first item' }]
    });

    const complete = await store.resolveComment(record.meta.id, 'comment-2');
    const resolved = await store.get(record.meta.id);

    expect(complete).toMatchObject({
      status: 'resolved',
      resolutionStatus: 'resolved',
      comments: { total: 2, resolved: 2, open: 0 }
    });
    expect(resolved?.meta.status).toBe('resolved');

    const reopened = await store.reopenComment(record.meta.id, 'comment-1');
    const reopenedRecord = await store.get(record.meta.id);

    expect(reopened).toMatchObject({
      status: 'submitted',
      resolutionStatus: 'partial',
      comments: { total: 2, resolved: 1, open: 1 }
    });
    expect(reopenedRecord?.meta.status).toBe('submitted');
    expect(reopenedRecord?.resolution?.comments.map((comment) => comment.commentId)).toEqual([
      'comment-2'
    ]);
  });

  it('rejects invalid comment IDs and pending review resolution', async () => {
    const store = new ReviewStore();
    const pending = await store.create(makeDiff(repoRoot));

    await expect(store.markResolved(pending.meta.id, 'too early')).rejects.toThrow(
      /cannot be resolved/
    );
    await expect(store.resolveComment(pending.meta.id, 'comment-1')).rejects.toThrow(
      /cannot be resolved/
    );

    await store.submit(pending.meta.id, [makeComment('comment-1')]);

    await expect(store.resolveComment(pending.meta.id, 'missing-comment')).rejects.toThrow(
      /not found/
    );
    await expect(store.reopenComment(pending.meta.id, 'missing-comment')).rejects.toThrow(
      /not found/
    );
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

function makeComment(id = 'comment-1'): Comment {
  return {
    id,
    filePath: 'app.ts',
    startLine: 1,
    endLine: 1,
    side: 'R',
    body: 'Looks good.',
    originalSnippet: 'export const value = 1;',
    createdAt: '2026-05-22T12:00:01.000Z'
  };
}
