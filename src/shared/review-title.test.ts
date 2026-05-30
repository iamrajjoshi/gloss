import { describe, expect, it } from 'vitest';
import { makeDiff } from '../test/factories';
import { reviewDisplayTitle } from './review-title';
import type { DiffPayload, ReviewRecord } from './types';

function makeRecord(diff: DiffPayload): ReviewRecord {
  const turn = {
    id: 'turn-1',
    index: 1,
    status: 'pending' as const,
    createdAt: diff.capturedAt,
    artifactDir: '/tmp/gloss/reviews/review-1/turns/turn-1',
    diffPath: '/tmp/gloss/reviews/review-1/turns/turn-1/diff.json',
    diff
  };
  return {
    meta: {
      id: 'review-1',
      cwd: diff.cwd,
      base: diff.base,
      branch: diff.branch,
      status: 'pending',
      createdAt: diff.capturedAt,
      artifactDir: '/tmp/gloss/reviews/review-1',
      activeTurnId: turn.id
    },
    turns: [turn],
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
