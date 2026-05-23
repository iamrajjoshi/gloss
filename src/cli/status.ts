import { ReviewStore } from '../server/store';
import type { ReviewMeta, ServerInfo } from '../shared/types';
import { serverUrl } from './lifecycle';
import { ServerClient } from './server-client';

export async function listReviewsForStatus({
  responsive,
  server
}: {
  responsive: boolean;
  server: ServerInfo | null;
}): Promise<ReviewMeta[]> {
  if (server && responsive) {
    try {
      return (await new ServerClient(serverUrl(server)).listReviews()).reviews;
    } catch {
      // Fall through to durable state if the daemon disappears between health and list.
    }
  }

  return new ReviewStore().list();
}
