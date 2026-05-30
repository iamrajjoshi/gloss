import { describe, expect, it } from 'vitest';
import { type FileFilterState, selectedExtensionIdsForFilterState } from './review-filter';

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
