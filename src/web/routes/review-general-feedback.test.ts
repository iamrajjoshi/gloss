import { describe, expect, it } from 'vitest';
import type { FeedbackBundle, GeneralComment, ResolutionBundle } from '../../shared/types';
import { makeComment } from '../../test/factories';
import { submittedGeneralFeedbackItems } from './review-general-feedback';

describe('submittedGeneralFeedbackItems', () => {
  it('returns submitted general comments and skips line comments', () => {
    const firstGeneral = makeGeneralComment('general-1', 'Summarize the release impact.');
    const secondGeneral = makeGeneralComment('general-2', 'Mention the migration risk.');

    expect(
      submittedGeneralFeedbackItems(
        makeFeedback([makeComment({ id: 'line-1' }), firstGeneral, secondGeneral])
      ).map((item) => item.comment)
    ).toEqual([firstGeneral, secondGeneral]);
  });

  it('pairs general comments with resolved state and summaries', () => {
    const openGeneral = makeGeneralComment('general-open', 'Add release notes.');
    const resolvedGeneral = makeGeneralComment('general-resolved', 'Call out the UI behavior.');

    expect(
      submittedGeneralFeedbackItems(makeFeedback([openGeneral, resolvedGeneral]), {
        reviewId: 'review-1',
        status: 'partial',
        summary: null,
        resolvedAt: null,
        comments: [
          {
            commentId: 'general-resolved',
            status: 'resolved',
            summary: 'added to the PR body',
            resolvedAt: '2026-06-22T12:05:00.000Z'
          }
        ]
      } satisfies ResolutionBundle)
    ).toEqual([
      {
        comment: openGeneral,
        resolvedComment: null,
        status: 'open',
        summary: null
      },
      {
        comment: resolvedGeneral,
        resolvedComment: {
          commentId: 'general-resolved',
          status: 'resolved',
          summary: 'added to the PR body',
          resolvedAt: '2026-06-22T12:05:00.000Z'
        },
        status: 'resolved',
        summary: 'added to the PR body'
      }
    ]);
  });
});

function makeFeedback(comments: FeedbackBundle['comments']): FeedbackBundle {
  return {
    version: 1,
    reviewId: 'review-1',
    timestamp: '2026-06-22T12:00:00.000Z',
    base: { ref: 'HEAD', sha: 'abc1234' },
    branch: 'raj--gloss--test',
    comments
  };
}

function makeGeneralComment(id: string, body: string): GeneralComment {
  return {
    kind: 'general',
    id,
    body,
    createdAt: '2026-06-22T12:00:01.000Z'
  };
}
