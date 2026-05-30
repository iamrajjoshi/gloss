import type { ReviewEvent } from '../../shared/types';

export function shouldReloadReviewForEvent(event: ReviewEvent): boolean {
  return (
    event.type === 'review.turn.created' ||
    event.type === 'review.submitted' ||
    event.type === 'review.updated'
  );
}
