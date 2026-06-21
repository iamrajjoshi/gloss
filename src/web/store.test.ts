import { beforeEach, describe, expect, it } from 'vitest';
import type { ResolutionBundle } from '../shared/types';
import { makeComment } from '../test/factories';
import { useReviewStore } from './store';

beforeEach(() => {
  useReviewStore.getState().reset();
});

describe('useReviewStore', () => {
  it('hydrates persisted feedback comments for read-only reviews', () => {
    const comments = [makeComment()];

    useReviewStore.getState().setDraft({
      filePath: 'app.ts',
      side: 'R',
      startLine: 4,
      endLine: 4,
      originalSnippet: 'export const value = 1;'
    });
    useReviewStore.getState().hydrateComments(comments);

    expect(useReviewStore.getState().comments).toEqual(comments);
    expect(useReviewStore.getState().resolution).toBeNull();
    expect(useReviewStore.getState().draft).toBeNull();
  });

  it('hydrates persisted comment resolution state for read-only reviews', () => {
    const comments = [makeComment()];
    const resolution: ResolutionBundle = {
      reviewId: 'review-1',
      status: 'partial',
      summary: null,
      resolvedAt: null,
      comments: [
        {
          commentId: 'comment-1',
          status: 'resolved',
          summary: 'fixed locally',
          resolvedAt: '2026-05-23T12:05:00.000Z'
        }
      ]
    };

    useReviewStore.getState().setDraft({
      filePath: 'app.ts',
      side: 'R',
      startLine: 4,
      endLine: 4,
      originalSnippet: 'export const value = 1;'
    });
    useReviewStore.getState().hydrateReview(comments, resolution);

    expect(useReviewStore.getState().comments).toEqual(comments);
    expect(useReviewStore.getState().resolution).toEqual(resolution);
    expect(useReviewStore.getState().draft).toBeNull();
  });

  it('adds general comments without a line draft', () => {
    useReviewStore.getState().addGeneralComment(' Update the release notes. ');

    expect(useReviewStore.getState().comments).toEqual([
      {
        kind: 'general',
        id: expect.any(String),
        body: 'Update the release notes.',
        createdAt: expect.any(String)
      }
    ]);
  });
});
