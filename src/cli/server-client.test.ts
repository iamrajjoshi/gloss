import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerClient } from './server-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServerClient.watchReview', () => {
  it('reconnects when an event stream closes before review submission', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        eventStream({ type: 'review.opened', reviewId: 'review-1' }, { close: true })
      )
      .mockResolvedValueOnce(
        eventStream(': keep-alive\n\n', {
          type: 'review.submitted',
          reviewId: 'review-1',
          counts: { files: 1, comments: 2 }
        })
      );
    vi.stubGlobal('fetch', fetch);

    const event = await new ServerClient('http://localhost:4321').watchReview('review-1');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(event).toEqual({
      type: 'review.submitted',
      reviewId: 'review-1',
      counts: { files: 1, comments: 2 }
    });
  });
});

function eventStream(
  ...chunks: Array<string | { close?: true } | Record<string, unknown>>
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          if (typeof chunk === 'string') {
            controller.enqueue(encoder.encode(chunk));
          } else if ('close' in chunk) {
            controller.close();
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
        }
      }
    })
  );
}
