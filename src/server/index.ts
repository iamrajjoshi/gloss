import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { globalReviewDir, packageVersion } from '../shared/paths';
import type { Comment, DiffPayload, ReviewEvent } from '../shared/types';
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
    return c.json({
      ok: true,
      version: packageVersion,
      activeReviews: reviews.filter((review) => review.status === 'pending').length
    });
  });

  app.get('/api/reviews', async (c) => c.json({ reviews: await reviewStore.list() }));

  app.post('/api/reviews', async (c) => {
    const diff = (await c.req.json()) as DiffPayload;
    const record = await reviewStore.create(diff);
    return c.json({ meta: record.meta, url: `${origin}/review/${record.meta.id}` }, 201);
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

    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        const write = (chunk: string) => {
          if (!closed) {
            controller.enqueue(encoder.encode(chunk));
          }
        };
        const close = () => {
          if (closed) {
            return;
          }
          closed = true;
          if (heartbeat) {
            clearInterval(heartbeat);
          }
          cleanup?.();
        };
        const send = (event: ReviewEvent) => {
          write(`data: ${JSON.stringify(event)}\n\n`);
          if (event.type === 'review.submitted' || event.type === 'review.cancelled') {
            close();
            controller.close();
          }
        };
        const unsubscribe = reviewStore.subscribe(id, send);
        heartbeat = setInterval(() => {
          write(`: keep-alive ${Date.now()}\n\n`);
        }, eventStreamHeartbeatMs);
        cleanup = () => {
          if (heartbeat) {
            clearInterval(heartbeat);
          }
          unsubscribe();
        };
        send({ type: 'review.opened', reviewId: id });
        if (
          (record.meta.status === 'submitted' || record.meta.status === 'resolved') &&
          record.feedback
        ) {
          send({
            type: 'review.submitted',
            reviewId: id,
            counts: {
              files: new Set(record.feedback.comments.map((comment) => comment.filePath)).size,
              comments: record.feedback.comments.length
            }
          });
        }
      },
      cancel() {
        cleanup?.();
      }
    });

    return new Response(stream, {
      headers: {
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
        'x-accel-buffering': 'no'
      }
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
    const body = (await c.req.json()) as { comments: Comment[] };
    const { record, feedbackPath, markdownPath } = await reviewStore.submit(
      id,
      body.comments ?? []
    );
    return c.json({
      reviewId: id,
      url: `${origin}/review/${id}`,
      files: record.diff.files.length,
      comments: body.comments?.length ?? 0,
      artifactDir: record.meta.artifactDir,
      feedbackPath,
      markdownPath
    });
  });

  app.post('/api/reviews/:id/resolved', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    if (existing.meta.status !== 'submitted' && existing.meta.status !== 'resolved') {
      return c.json({ error: `review is ${existing.meta.status} and cannot be resolved` }, 409);
    }
    if (!existing.feedback) {
      return c.json({ error: 'submitted feedback not found' }, 409);
    }
    const body = (await c.req.json().catch(() => ({}))) as { summary?: string };
    return c.json(await reviewStore.markResolved(id, body.summary));
  });

  app.post('/api/reviews/:id/comments/:commentId/resolved', async (c) => {
    const id = c.req.param('id');
    const commentId = c.req.param('commentId');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    if (existing.meta.status !== 'submitted' && existing.meta.status !== 'resolved') {
      return c.json({ error: `review is ${existing.meta.status} and cannot be resolved` }, 409);
    }
    if (!existing.feedback?.comments.some((comment) => comment.id === commentId)) {
      return c.json({ error: 'comment not found' }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as { summary?: string };
    return c.json(await reviewStore.resolveComment(id, commentId, body.summary));
  });

  app.delete('/api/reviews/:id/comments/:commentId/resolved', async (c) => {
    const id = c.req.param('id');
    const commentId = c.req.param('commentId');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    if (existing.meta.status !== 'submitted' && existing.meta.status !== 'resolved') {
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

export function getReviewArtifactDir(_cwd: string, reviewId: string): string {
  return globalReviewDir(reviewId);
}
