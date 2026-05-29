import { describe, expect, it } from 'vitest';
import { type FileFilterState, syncFileFilterState } from './Review';

describe('syncFileFilterState', () => {
  it('selects new extension buckets when every previous bucket was selected', () => {
    const current = makeFilterState({
      extensionIds: ['.ts', '.tsx'],
      selectedExtensionIds: ['.ts', '.tsx']
    });

    const next = syncFileFilterState(current, 'review-1', ['.md', '.ts', '.tsx']);

    expect([...next.selectedExtensionIds]).toEqual(['.md', '.ts', '.tsx']);
    expect(next.searchQuery).toBe('tree');
  });

  it('keeps manually narrowed extension filters narrowed across bucket updates', () => {
    const current = makeFilterState({
      extensionIds: ['.ts', '.tsx'],
      selectedExtensionIds: ['.tsx']
    });

    const next = syncFileFilterState(current, 'review-1', ['.md', '.ts', '.tsx']);

    expect([...next.selectedExtensionIds]).toEqual(['.tsx']);
  });
});

function makeFilterState({
  extensionIds,
  selectedExtensionIds
}: {
  extensionIds: string[];
  selectedExtensionIds: string[];
}): FileFilterState {
  return {
    extensionIds,
    reviewId: 'review-1',
    searchQuery: 'tree',
    selectedExtensionIds: new Set(selectedExtensionIds)
  };
}
