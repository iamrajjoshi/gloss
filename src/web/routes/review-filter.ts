export interface FileFilterState {
  reviewId: string | null;
  searchQuery: string;
  selectedExtensionIds: Set<string> | null;
}

export function selectedExtensionIdsForFilterState(
  current: FileFilterState,
  recordId: string,
  extensionIds: string[]
): Set<string> {
  if (current.reviewId !== recordId || !current.selectedExtensionIds) {
    return new Set(extensionIds);
  }
  return new Set(
    extensionIds.filter((extensionId) => current.selectedExtensionIds?.has(extensionId))
  );
}
