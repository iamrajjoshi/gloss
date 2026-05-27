import type { ReviewStatus } from './types';

export function isResolvableReviewStatus(status: ReviewStatus): boolean {
  return status === 'submitted' || status === 'resolved';
}
