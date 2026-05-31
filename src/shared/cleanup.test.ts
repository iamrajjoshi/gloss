import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearReviewArtifacts, DEFAULT_REVIEW_RETENTION_DAYS } from './cleanup';
import {
  globalReviewDir,
  globalReviewMetaFile,
  globalReviewTurnDir,
  globalReviewTurnMetaFile
} from './paths';
import type { ReviewMeta, ReviewStatus, ReviewTurnMeta, ReviewTurnSummary } from './types';

const originalStateDir = process.env.GLOSS_STATE_DIR;
let tempDirs: string[] = [];

beforeEach(async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-cleanup-state-'));
  tempDirs = [stateDir];
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

describe('clearReviewArtifacts', () => {
  it('deletes completed reviews older than the default retention and preserves pending or recent reviews', async () => {
    await writeReviewMeta('old-submitted', 'submitted', {
      createdAt: '2026-03-01T00:00:00.000Z',
      submittedAt: '2026-03-02T00:00:00.000Z'
    });
    await writeReviewMeta('old-resolved', 'resolved', {
      createdAt: '2026-03-01T00:00:00.000Z',
      resolvedAt: '2026-03-05T00:00:00.000Z'
    });
    await writeReviewMeta('old-cancelled', 'cancelled', {
      createdAt: '2026-03-01T00:00:00.000Z'
    });
    await writeReviewMeta('old-pending', 'pending', {
      createdAt: '2026-03-01T00:00:00.000Z'
    });
    await writeReviewMeta('recent-turn', 'submitted', {
      createdAt: '2026-03-01T00:00:00.000Z',
      turns: [makeTurnSummary('recent-turn', '2026-05-20T00:00:00.000Z')]
    });

    const result = await clearReviewArtifacts({
      now: new Date('2026-05-31T00:00:00.000Z')
    });

    expect(result.olderThanDays).toBe(DEFAULT_REVIEW_RETENTION_DAYS);
    expect(result.cutoff).toBe('2026-05-01T00:00:00.000Z');
    expect(result.candidates.map((review) => review.reviewId).sort()).toEqual([
      'old-cancelled',
      'old-resolved',
      'old-submitted'
    ]);
    expect(result.deleted.map((review) => review.reviewId).sort()).toEqual([
      'old-cancelled',
      'old-resolved',
      'old-submitted'
    ]);
    expect(result.counts).toEqual({ candidates: 3, deleted: 3, skipped: 0 });
    expect(existsSync(globalReviewDir('old-submitted'))).toBe(false);
    expect(existsSync(globalReviewDir('old-resolved'))).toBe(false);
    expect(existsSync(globalReviewDir('old-cancelled'))).toBe(false);
    expect(existsSync(globalReviewDir('old-pending'))).toBe(true);
    expect(existsSync(globalReviewDir('recent-turn'))).toBe(true);
  });

  it('reports dry-run candidates without deleting artifacts', async () => {
    await writeReviewMeta('old-submitted', 'submitted', {
      createdAt: '2026-03-01T00:00:00.000Z'
    });

    const result = await clearReviewArtifacts({
      dryRun: true,
      olderThanDays: 30,
      now: new Date('2026-05-31T00:00:00.000Z')
    });

    expect(result.dryRun).toBe(true);
    expect(result.counts).toEqual({ candidates: 1, deleted: 0, skipped: 0 });
    expect(result.candidates[0]?.reviewId).toBe('old-submitted');
    expect(result.deleted).toEqual([]);
    expect(existsSync(globalReviewDir('old-submitted'))).toBe(true);
  });

  it('preserves reviews with a pending persisted turn even when root metadata is stale', async () => {
    await writeReviewMeta('stale-root', 'submitted', {
      createdAt: '2026-03-01T00:00:00.000Z',
      submittedAt: '2026-03-02T00:00:00.000Z'
    });
    await writeTurnMeta('stale-root', {
      id: 'turn-2',
      index: 2,
      status: 'pending',
      createdAt: '2026-05-20T00:00:00.000Z'
    });

    const result = await clearReviewArtifacts({
      olderThanDays: 30,
      now: new Date('2026-05-31T00:00:00.000Z')
    });

    expect(result.counts).toEqual({ candidates: 0, deleted: 0, skipped: 0 });
    expect(existsSync(globalReviewDir('stale-root'))).toBe(true);
  });

  it('skips review directories with missing or invalid metadata', async () => {
    await mkdir(globalReviewDir('missing-meta'), { recursive: true });
    await mkdir(globalReviewDir('invalid-meta'), { recursive: true });
    await writeFile(globalReviewMetaFile('invalid-meta'), '{invalid json\n');

    const result = await clearReviewArtifacts({
      olderThanDays: 30,
      now: new Date('2026-05-31T00:00:00.000Z')
    });

    expect(result.counts).toEqual({ candidates: 0, deleted: 0, skipped: 2 });
    expect(result.skipped.map((entry) => entry.reviewId).sort()).toEqual([
      'invalid-meta',
      'missing-meta'
    ]);
    expect(existsSync(globalReviewDir('missing-meta'))).toBe(true);
    expect(existsSync(globalReviewDir('invalid-meta'))).toBe(true);
  });
});

async function writeReviewMeta(
  reviewId: string,
  status: ReviewStatus,
  overrides: Partial<ReviewMeta>
): Promise<void> {
  await mkdir(globalReviewDir(reviewId), { recursive: true });
  const meta: ReviewMeta = {
    id: reviewId,
    cwd: '/tmp/repo',
    base: { ref: 'HEAD', sha: '1234567890abcdef1234567890abcdef12345678' },
    branch: null,
    status,
    createdAt: '2026-03-01T00:00:00.000Z',
    artifactDir: globalReviewDir(reviewId),
    ...overrides
  };
  await writeFile(globalReviewMetaFile(reviewId), `${JSON.stringify(meta, null, 2)}\n`);
  await writeFile(path.join(globalReviewDir(reviewId), 'artifact.txt'), 'review artifact\n');
}

async function writeTurnMeta(
  reviewId: string,
  overrides: Pick<ReviewTurnMeta, 'id' | 'index' | 'status' | 'createdAt'>
): Promise<void> {
  await mkdir(globalReviewTurnDir(reviewId, overrides.id), { recursive: true });
  const turn: ReviewTurnMeta = {
    artifactDir: globalReviewTurnDir(reviewId, overrides.id),
    diffPath: path.join(globalReviewTurnDir(reviewId, overrides.id), 'diff.json'),
    ...overrides
  };
  await writeFile(
    globalReviewTurnMetaFile(reviewId, overrides.id),
    `${JSON.stringify(turn, null, 2)}\n`
  );
}

function makeTurnSummary(reviewId: string, capturedAt: string): ReviewTurnSummary {
  const artifactDir = path.join(globalReviewDir(reviewId), 'turns', 'turn-1');
  return {
    id: 'turn-1',
    index: 1,
    status: 'submitted',
    createdAt: '2026-03-01T00:00:00.000Z',
    submittedAt: capturedAt,
    artifactDir,
    diffPath: path.join(artifactDir, 'diff.json'),
    capturedAt,
    stats: { files: 1, additions: 1, deletions: 0 },
    comments: { total: 1, resolved: 0, open: 1 }
  };
}
