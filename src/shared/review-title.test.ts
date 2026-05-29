import { describe, expect, it } from 'vitest';
import { makeDiff } from '../test/factories';
import { reviewDisplayTitle } from './review-title';
import type { DiffPayload, ReviewRecord } from './types';

function makeRecord(diff: DiffPayload): ReviewRecord {
  return {
    meta: {
      id: 'review-1',
      cwd: diff.cwd,
      base: diff.base,
      branch: diff.branch,
      status: 'pending',
      createdAt: diff.capturedAt,
      artifactDir: '/tmp/gloss/reviews/review-1'
    },
    diff
  };
}

describe('reviewDisplayTitle', () => {
  it('uses the branch name', () => {
    const record = makeRecord(makeDiff({ cwd: '/repo', branch: 'raj--gloss--titles' }));

    expect(reviewDisplayTitle(record)).toBe('raj--gloss--titles');
  });

  it('falls back to the scope title for detached reviews', () => {
    const record = makeRecord(makeDiff({ cwd: '/repo', branch: null }));

    expect(reviewDisplayTitle(record)).toBe('Working changes');
  });
});
