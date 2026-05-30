import type { ReviewTurn } from '../../shared/types';

export interface ReviewTitlePresentation {
  icon: 'branch' | null;
}

export interface BranchPill {
  label: string;
  title: string;
}

export function reviewTitlePresentation(
  branch: string | null | undefined,
  displayTitle: string
): ReviewTitlePresentation {
  return {
    icon: branch?.trim() === displayTitle.trim() ? 'branch' : null
  };
}

export function branchPillForTitle(
  branch: string | null | undefined,
  displayTitle: string
): BranchPill | null {
  const trimmedBranch = branch?.trim() ?? '';
  const label = trimmedBranch || 'detached';
  if (label === displayTitle.trim()) {
    return null;
  }
  return {
    label,
    title: trimmedBranch || 'Detached HEAD'
  };
}

export function shouldShowTurnHistory(turns: readonly Pick<ReviewTurn, 'id'>[]): boolean {
  return turns.length > 1;
}
