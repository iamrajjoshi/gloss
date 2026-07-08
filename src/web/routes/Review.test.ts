import { describe, expect, it } from 'vitest';
import type { ReviewEvent } from '../../shared/types';
import { mergeReviewEvents } from './Review';
import { shouldReloadReviewForEvent } from './review-events';
import { type FileFilterState, selectedExtensionIdsForFilterState } from './review-filter';
import {
  branchPillForTitle,
  reviewTitlePresentation,
  shouldShowTurnHistory
} from './review-header';

describe('selectedExtensionIdsForFilterState', () => {
  it('selects new extension buckets when every previous bucket was selected', () => {
    const current = makeFilterState({
      selectedExtensionIds: null
    });

    const selectedExtensionIds = selectedExtensionIdsForFilterState(current, 'review-1', [
      '.md',
      '.ts',
      '.tsx'
    ]);

    expect([...selectedExtensionIds]).toEqual(['.md', '.ts', '.tsx']);
  });

  it('keeps manually narrowed extension filters narrowed across bucket updates', () => {
    const current = makeFilterState({
      selectedExtensionIds: ['.tsx']
    });

    const selectedExtensionIds = selectedExtensionIdsForFilterState(current, 'review-1', [
      '.md',
      '.ts',
      '.tsx'
    ]);

    expect([...selectedExtensionIds]).toEqual(['.tsx']);
  });

  it('selects all current buckets when state belongs to another review', () => {
    const current = makeFilterState({
      reviewId: 'review-2',
      selectedExtensionIds: ['.tsx']
    });

    const selectedExtensionIds = selectedExtensionIdsForFilterState(current, 'review-1', [
      '.md',
      '.tsx'
    ]);

    expect([...selectedExtensionIds]).toEqual(['.md', '.tsx']);
  });
});

describe('shouldReloadReviewForEvent', () => {
  it('reloads when the active review gains another turn', () => {
    const event: ReviewEvent = {
      type: 'review.turn.created',
      reviewId: 'review-1',
      turnId: 'turn-2',
      turnIndex: 2,
      reused: false
    };

    expect(shouldReloadReviewForEvent(event)).toBe(true);
  });

  it('does not reload for the initial opened event', () => {
    expect(shouldReloadReviewForEvent({ type: 'review.opened', reviewId: 'review-1' })).toBe(false);
  });

  it('does not reload for agent progress notes', () => {
    expect(
      shouldReloadReviewForEvent({
        type: 'agent.note',
        reviewId: 'review-1',
        status: 'working',
        message: 'Applying feedback.'
      })
    ).toBe(false);
  });
});

describe('mergeReviewEvents', () => {
  it('orders replayed and live events by sequence while replacing duplicates', () => {
    const opened: ReviewEvent = { type: 'review.opened', reviewId: 'review-1', seq: 1 };
    const submitted: ReviewEvent = {
      type: 'review.submitted',
      reviewId: 'review-1',
      seq: 2,
      counts: { files: 1, comments: 1 }
    };
    const note: ReviewEvent = {
      type: 'agent.note',
      reviewId: 'review-1',
      seq: 3,
      status: 'working',
      message: 'Applying feedback.'
    };

    expect(mergeReviewEvents([submitted, opened], note)).toEqual([opened, submitted, note]);
    expect(
      mergeReviewEvents([opened, submitted, note], { ...note, message: 'Still working.' })
    ).toEqual([opened, submitted, { ...note, message: 'Still working.' }]);
  });
});

describe('branchPillForTitle', () => {
  it('hides branch metadata when it duplicates the review title', () => {
    expect(branchPillForTitle('main', 'main')).toBeNull();
  });

  it('shows detached metadata when the title is not a branch name', () => {
    expect(branchPillForTitle(null, 'Working changes')).toEqual({
      label: 'detached',
      title: 'Detached HEAD'
    });
  });
});

describe('reviewTitlePresentation', () => {
  it('shows a branch icon when the title is the branch name', () => {
    expect(reviewTitlePresentation('main', 'main')).toEqual({ icon: 'branch' });
  });

  it('keeps fallback titles plain', () => {
    expect(reviewTitlePresentation(null, 'Working changes')).toEqual({ icon: null });
  });
});

describe('shouldShowTurnHistory', () => {
  it('only shows turn history after a review has multiple turns', () => {
    expect(shouldShowTurnHistory([{ id: 'turn-1' }])).toBe(false);
    expect(shouldShowTurnHistory([{ id: 'turn-1' }, { id: 'turn-2' }])).toBe(true);
  });
});

function makeFilterState({
  reviewId = 'review-1',
  selectedExtensionIds
}: {
  reviewId?: string;
  selectedExtensionIds: string[] | null;
}): FileFilterState {
  return {
    reviewId,
    searchQuery: 'tree',
    selectedExtensionIds: selectedExtensionIds ? new Set(selectedExtensionIds) : null
  };
}
