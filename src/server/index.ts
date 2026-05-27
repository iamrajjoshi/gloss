import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { countCommentFiles } from '../shared/comments';
import { packageVersion } from '../shared/paths';
import { isResolvableReviewStatus } from '../shared/reviews';
import type {
  CreateReviewResponse,
  HealthResponse,
  ListReviewsResponse,
  OpenResult,
  ResolutionRequest,
  ReviewEvent,
  SubmitReviewRequest
} from '../shared/types';
import {
  isDiffPayload,
  isResolutionRequest,
  isSubmitReviewRequest,
  type JsonGuard,
  parseJsonValue
} from '../shared/validation';
import { reviewStore } from './store';

const webRoot = fileURLToPath(new URL('../web', import.meta.url));
const eventStreamHeartbeatMs = 15_000;

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.sh': 'text/x-shellscript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export function createApp(origin: string): Hono {
  const app = new Hono();

  app.get('/api/health', async (c) => {
    const reviews = await reviewStore.list();
    const response: HealthResponse = {
      ok: true,
      version: packageVersion,
      activeReviews: reviews.filter((review) => review.status === 'pending').length
    };
    return c.json(response);
  });

  app.get('/api/reviews', async (c) => {
    const response: ListReviewsResponse = { reviews: await reviewStore.list() };
    return c.json(response);
  });

  app.post('/api/reviews', async (c) => {
    const parsed = await readJsonBody(c, isDiffPayload, 'review diff');
    if (!parsed.ok) {
      return parsed.response;
    }
    const diff = parsed.body;
    const record = await reviewStore.create(diff);
    const response: CreateReviewResponse = {
      meta: record.meta,
      url: `${origin}/review/${record.meta.id}`
    };
    return c.json(response, 201);
  });

  app.get('/api/reviews/:id', async (c) => {
    const record = await reviewStore.get(c.req.param('id'));
    if (!record) {
      return c.json({ error: 'review not found' }, 404);
    }
    return c.json(record);
  });

  app.get('/api/reviews/:id/feedback', async (c) => {
    const feedback = await reviewStore.feedback(c.req.param('id'));
    if (!feedback) {
      return c.json({ error: 'feedback not found' }, 404);
    }
    return c.json(feedback);
  });

  app.get('/api/reviews/:id/events', async (c) => {
    const id = c.req.param('id');
    const record = await reviewStore.get(id);
    if (!record) {
      return c.json({ error: 'review not found' }, 404);
    }

    return streamSSE(c, async (stream) => {
      let closed = false;
      let pending: Promise<void> = Promise.resolve();
      let cleanup: (() => void) | null = null;
      let close: (() => void) | null = null;
      const closedPromise = new Promise<void>((resolve) => {
        close = () => {
          if (closed) {
            return;
          }
          closed = true;
          cleanup?.();
          resolve();
        };
      });
      const send = (event: ReviewEvent) => {
        pending = pending
          .then(() => stream.writeSSE({ data: JSON.stringify(event) }))
          .then(() => {
            if (event.type === 'review.cancelled') {
              close?.();
            }
          });
        void pending.catch(() => close?.());
      };
      const unsubscribe = reviewStore.subscribe(id, send);
      const heartbeat = setInterval(() => {
        pending = pending.then(async () => {
          await stream.write(`: keep-alive ${Date.now()}\n\n`);
        });
        void pending.catch(() => close?.());
      }, eventStreamHeartbeatMs);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      stream.onAbort(() => close?.());

      send({ type: 'review.opened', reviewId: id });
      if (isResolvableReviewStatus(record.meta.status) && record.feedback) {
        send({
          type: 'review.submitted',
          reviewId: id,
          counts: {
            files: countCommentFiles(record.feedback.comments),
            comments: record.feedback.comments.length
          }
        });
      }
      await closedPromise;
    });
  });

  app.post('/api/reviews/:id/submit', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    if (existing.meta.status !== 'pending') {
      return c.json({ error: `review is ${existing.meta.status} and cannot be submitted` }, 409);
    }
    const parsed = await readJsonBody(c, isSubmitReviewRequest, 'submit review request');
    if (!parsed.ok) {
      return parsed.response;
    }
    const body: SubmitReviewRequest = parsed.body;
    const { record, feedbackPath, markdownPath } = await reviewStore.submit(id, body.comments);
    const response: OpenResult = {
      reviewId: id,
      url: `${origin}/review/${id}`,
      files: record.diff.files.length,
      comments: body.comments.length,
      artifactDir: record.meta.artifactDir,
      feedbackPath,
      markdownPath
    };
    return c.json(response);
  });

  app.post('/api/reviews/:id/resolved', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    if (!isResolvableReviewStatus(existing.meta.status)) {
      return c.json({ error: `review is ${existing.meta.status} and cannot be resolved` }, 409);
    }
    if (!existing.feedback) {
      return c.json({ error: 'submitted feedback not found' }, 409);
    }
    const parsed = await readJsonBody(c, isResolutionRequest, 'resolution request');
    if (!parsed.ok) {
      return parsed.response;
    }
    const body: ResolutionRequest = parsed.body;
    return c.json(await reviewStore.markResolved(id, body.summary));
  });

  app.post('/api/reviews/:id/comments/:commentId/resolved', async (c) => {
    const id = c.req.param('id');
    const commentId = c.req.param('commentId');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    if (!isResolvableReviewStatus(existing.meta.status)) {
      return c.json({ error: `review is ${existing.meta.status} and cannot be resolved` }, 409);
    }
    if (!existing.feedback?.comments.some((comment) => comment.id === commentId)) {
      return c.json({ error: 'comment not found' }, 404);
    }
    const parsed = await readJsonBody(c, isResolutionRequest, 'resolution request');
    if (!parsed.ok) {
      return parsed.response;
    }
    const body: ResolutionRequest = parsed.body;
    return c.json(await reviewStore.resolveComment(id, commentId, body.summary));
  });

  app.delete('/api/reviews/:id/comments/:commentId/resolved', async (c) => {
    const id = c.req.param('id');
    const commentId = c.req.param('commentId');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    if (!isResolvableReviewStatus(existing.meta.status)) {
      return c.json({ error: `review is ${existing.meta.status} and cannot be resolved` }, 409);
    }
    if (!existing.feedback?.comments.some((comment) => comment.id === commentId)) {
      return c.json({ error: 'comment not found' }, 404);
    }
    return c.json(await reviewStore.reopenComment(id, commentId));
  });

  app.get('/logo.svg', serveRootFile('logo.svg', mimeTypes['.svg']));
  app.get('/logo-mark.svg', serveRootFile('logo-mark.svg', mimeTypes['.svg']));
  app.get('/og.png', serveRootFile('og.png', mimeTypes['.png']));
  app.get('/install.sh', serveRootFile('install.sh', mimeTypes['.sh']));
  app.get('/setup.md', serveRootFile('setup.md', 'text/markdown; charset=utf-8'));
  app.get('/prompt.md', serveRootFile('prompt.md', 'text/markdown; charset=utf-8'));
  app.get('/assets/*', serveAsset);
  app.get('/setup', serveIndex);
  app.get('/setup/', serveIndex);
  app.get('/review/:id', serveIndex);
  app.get('/', serveIndex);

  return app;
}

async function serveAsset(c: Context) {
  const requestPath = new URL(c.req.url).pathname.replace(/^\/assets\//, '');
  const normalized = path.normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const assetPath = path.join(webRoot, 'assets', normalized);
  try {
    const body = await readFile(assetPath);
    return new Response(body, {
      headers: {
        'content-type': mimeTypes[path.extname(assetPath)] ?? 'application/octet-stream'
      }
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

async function serveIndex() {
  try {
    const body = await readFile(path.join(webRoot, 'index.html'));
    return new Response(body, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  } catch {
    return new Response('Gloss web assets are missing. Run pnpm build.', { status: 500 });
  }
}

function serveRootFile(fileName: string, contentType: string) {
  return async () => {
    try {
      const body = await readFile(path.join(webRoot, fileName));
      return new Response(body, {
        headers: { 'content-type': contentType }
      });
    } catch {
      return new Response(`${fileName} is missing. Run pnpm build.`, { status: 404 });
    }
  };
}

async function readJsonBody<T>(
  c: Context,
  guard: JsonGuard<T>,
  label: string
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    return {
      ok: false,
      response: c.json({ error: `invalid JSON body: ${formatError(error)}` }, 400)
    };
  }

  try {
    return { ok: true, body: parseJsonValue(body, guard, label) };
  } catch (error) {
    return {
      ok: false,
      response: c.json({ error: formatError(error) }, 400)
    };
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
