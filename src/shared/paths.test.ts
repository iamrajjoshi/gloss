import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  expandHome,
  globalLogDir,
  globalReviewDiffFile,
  globalReviewDir,
  globalReviewFeedbackFile,
  globalReviewMarkdownFile,
  globalReviewMetaFile,
  globalReviewResolvedFile,
  globalReviewsDir,
  globalServerFile,
  globalServerLogFile,
  globalStateDir
} from './paths';

const originalStateDir = process.env.GLOSS_STATE_DIR;

afterEach(() => {
  if (originalStateDir === undefined) {
    delete process.env.GLOSS_STATE_DIR;
  } else {
    process.env.GLOSS_STATE_DIR = originalStateDir;
  }
});

describe('global Gloss paths', () => {
  it('defaults to ~/.gloss for server, logs, and reviews', () => {
    delete process.env.GLOSS_STATE_DIR;

    const root = path.join(homedir(), '.gloss');
    expect(globalStateDir()).toBe(root);
    expect(globalServerFile()).toBe(path.join(root, 'server.json'));
    expect(globalLogDir()).toBe(path.join(root, 'logs'));
    expect(globalServerLogFile()).toBe(path.join(root, 'logs', 'server.log'));
    expect(globalReviewsDir()).toBe(path.join(root, 'reviews'));
  });

  it('uses GLOSS_STATE_DIR as the state root', () => {
    process.env.GLOSS_STATE_DIR = path.join('/tmp', 'gloss-test-state');

    const reviewId = '01KTESTREVIEW';
    expect(globalStateDir()).toBe(process.env.GLOSS_STATE_DIR);
    expect(globalReviewDir(reviewId)).toBe(
      path.join(process.env.GLOSS_STATE_DIR, 'reviews', reviewId)
    );
    expect(globalReviewMetaFile(reviewId)).toBe(
      path.join(process.env.GLOSS_STATE_DIR, 'reviews', reviewId, 'meta.json')
    );
    expect(globalReviewDiffFile(reviewId)).toBe(
      path.join(process.env.GLOSS_STATE_DIR, 'reviews', reviewId, 'diff.json')
    );
    expect(globalReviewFeedbackFile(reviewId)).toBe(
      path.join(process.env.GLOSS_STATE_DIR, 'reviews', reviewId, 'feedback.json')
    );
    expect(globalReviewMarkdownFile(reviewId)).toBe(
      path.join(process.env.GLOSS_STATE_DIR, 'reviews', reviewId, 'feedback.md')
    );
    expect(globalReviewResolvedFile(reviewId)).toBe(
      path.join(process.env.GLOSS_STATE_DIR, 'reviews', reviewId, 'resolved.json')
    );
  });

  it('expands home-prefixed paths', () => {
    expect(expandHome('~/custom-gloss')).toBe(path.join(homedir(), 'custom-gloss'));
  });
});
