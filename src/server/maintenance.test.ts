import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globalReviewDir, globalReviewMetaFile } from '../shared/paths';
import type { ReviewMeta } from '../shared/types';

const originalStateDir = process.env.GLOSS_STATE_DIR;
let tempDirs: string[] = [];

beforeEach(async () => {
  vi.resetModules();
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-maintenance-state-'));
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

describe('runStartupCleanup', () => {
  it('prunes old completed reviews without blocking daemon startup', async () => {
    await writeReviewMeta('old-resolved');
    const logs: string[] = [];
    const errors: string[] = [];
    const { runStartupCleanup } = await import('./maintenance');

    await runStartupCleanup({
      info: (message) => logs.push(message),
      error: (message) => errors.push(message)
    });

    expect(existsSync(globalReviewDir('old-resolved'))).toBe(false);
    expect(logs).toEqual(['Gloss cleanup deleted 1 review artifact(s); skipped 0']);
    expect(errors).toEqual([]);
  });

  it('logs cleanup failures and still resolves', async () => {
    const stateFile = path.join(tmpdir(), `gloss-state-file-${Date.now()}`);
    await writeFile(stateFile, 'not a directory\n');
    tempDirs.push(stateFile);
    process.env.GLOSS_STATE_DIR = stateFile;
    const logs: string[] = [];
    const errors: string[] = [];
    const { runStartupCleanup } = await import('./maintenance');

    await expect(
      runStartupCleanup({
        info: (message) => logs.push(message),
        error: (message) => errors.push(message)
      })
    ).resolves.toBeUndefined();

    expect(logs).toEqual([]);
    expect(errors[0]).toMatch(/^Gloss cleanup failed:/);
  });
});

async function writeReviewMeta(reviewId: string): Promise<void> {
  await mkdir(globalReviewDir(reviewId), { recursive: true });
  const meta: ReviewMeta = {
    id: reviewId,
    cwd: '/tmp/repo',
    base: { ref: 'HEAD', sha: '1234567890abcdef1234567890abcdef12345678' },
    branch: null,
    status: 'resolved',
    createdAt: '2000-01-01T00:00:00.000Z',
    resolvedAt: '2000-01-02T00:00:00.000Z',
    artifactDir: globalReviewDir(reviewId)
  };
  await writeFile(globalReviewMetaFile(reviewId), `${JSON.stringify(meta, null, 2)}\n`);
}
