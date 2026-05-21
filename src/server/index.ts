import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { packageVersion, reviewDir } from '../shared/paths';
import type { Comment, DiffPayload, ReviewEvent } from '../shared/types';
import { reviewStore } from './store';

const webRoot = fileURLToPath(new URL('../web', import.meta.url));

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export function createApp(origin: string): Hono {
  const app = new Hono();

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      version: packageVersion,
      activeReviews: reviewStore.list().length
    })
  );

  app.get('/api/reviews', (c) => c.json({ reviews: reviewStore.list() }));

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
        const send = (event: ReviewEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === 'review.completed' || event.type === 'review.cancelled') {
            cleanup?.();
            controller.close();
          }
        };
        cleanup = reviewStore.subscribe(id, send);
        send({ type: 'review.opened', reviewId: id });
        if (record.meta.status === 'completed' && record.feedback) {
          send({
            type: 'review.completed',
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
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream'
      }
    });
  });

  app.post('/api/reviews/:id/submit', async (c) => {
    const id = c.req.param('id');
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
      feedbackPath,
      markdownPath
    });
  });

  app.post('/api/reviews/:id/resolved', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { summary?: string };
    const resolvedPath = await reviewStore.markResolved(c.req.param('id'), body.summary);
    return c.json({ ok: true, path: resolvedPath });
  });

  app.get('/setup.md', serveRootFile('setup.md', 'text/markdown; charset=utf-8'));
  app.get('/prompt.md', serveRootFile('prompt.md', 'text/markdown; charset=utf-8'));
  app.get('/assets/*', serveAsset);
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

export function getReviewArtifactDir(cwd: string, reviewId: string): string {
  return reviewDir(cwd, reviewId);
}
