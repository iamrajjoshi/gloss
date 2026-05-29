export interface FileFilterState {
  extensionIds: string[];
  reviewId: string | null;
  searchQuery: string;
  selectedExtensionIds: Set<string>;
}

export function syncFileFilterState(
  current: FileFilterState,
  recordId: string,
  extensionIds: string[]
): FileFilterState {
  if (current.reviewId !== recordId) {
    return {
      extensionIds,
      reviewId: recordId,
      searchQuery: '',
      selectedExtensionIds: new Set(extensionIds)
    };
  }

  const previousAllSelected =
    current.selectedExtensionIds.size === current.extensionIds.length &&
    current.extensionIds.every((extensionId) => current.selectedExtensionIds.has(extensionId));
  const selectedExtensionIds = previousAllSelected
    ? new Set(extensionIds)
    : new Set(extensionIds.filter((extensionId) => current.selectedExtensionIds.has(extensionId)));

  return {
    extensionIds,
    reviewId: recordId,
    searchQuery: current.searchQuery,
    selectedExtensionIds
  };
}
