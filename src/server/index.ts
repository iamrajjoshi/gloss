import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { countCommentFiles } from '../shared/comments';
import { formatError, isFileNotFound } from '../shared/errors';
import { captureCommitRangeDiff } from '../shared/git-diff';
import type { JsonValue } from '../shared/json';
import { packageVersion } from '../shared/paths';
import { isResolvableReviewStatus } from '../shared/reviews';
import type {
  CommitRangeDiffResponse,
  CreateReviewResponse,
  HealthResponse,
  ListReviewsResponse,
  OpenFileResponse,
  OpenResult,
  ResolutionRequest,
  ReviewEvent,
  SubmitReviewRequest
} from '../shared/types';
import {
  isCommitRangeDiffRequest,
  isDiffPayload,
  isOpenFileRequest,
  isResolutionRequest,
  isSubmitReviewRequest,
  type JsonGuard,
  parseJsonValue
} from '../shared/validation';
import { openLocalPath } from './local-open';
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

  app.post('/api/reviews/:id/commits/range', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    const parsed = await readJsonBody(c, isCommitRangeDiffRequest, 'commit range diff request');
    if (!parsed.ok) {
      return parsed.response;
    }

    const commitDiffs = existing.diff.commitDiffs ?? [];
    if (commitDiffs.length === 0) {
      return c.json({ error: 'commit ranges are only available for branch reviews' }, 409);
    }

    const { fromSha, toSha } = parsed.body;
    const fromIndex = commitDiffs.findIndex((commitDiff) => commitDiff.commit.sha === fromSha);
    const toIndex = commitDiffs.findIndex((commitDiff) => commitDiff.commit.sha === toSha);
    if (fromIndex < 0 || toIndex < 0) {
      return c.json({ error: 'commit range must use commits from this review' }, 404);
    }
    if (fromIndex > toIndex) {
      return c.json({ error: 'fromSha must come before or match toSha' }, 400);
    }

    const diff =
      fromSha === toSha
        ? commitDiffs[fromIndex]
        : await captureCommitRangeDiff(fromSha, toSha, existing.diff.cwd);
    const response: CommitRangeDiffResponse = {
      fromSha,
      toSha,
      stats: diff.stats,
      rawDiff: diff.rawDiff,
      files: diff.files
    };
    return c.json(response);
  });

  app.post('/api/reviews/:id/files/open', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    const parsed = await readJsonBody(c, isOpenFileRequest, 'open file request');
    if (!parsed.ok) {
      return parsed.response;
    }

    const { filePath } = parsed.body;
    if (!filePath || filePath.includes('\0') || path.isAbsolute(filePath)) {
      return c.json({ error: 'filePath must be a repo-relative path' }, 400);
    }

    const repoRoot = path.resolve(existing.diff.cwd);
    const requestedAbsolutePath = path.resolve(repoRoot, filePath);
    if (!isPathWithin(repoRoot, requestedAbsolutePath)) {
      return c.json({ error: 'filePath must stay within the review cwd' }, 400);
    }

    const reviewFiles = [
      ...existing.diff.files,
      ...(existing.diff.commitDiffs ?? []).flatMap((commitDiff) => commitDiff.files)
    ].filter((file) => file.path === filePath);
    if (reviewFiles.length === 0) {
      return c.json({ error: 'file is not part of this review' }, 404);
    }
    if (reviewFiles.every((file) => file.isDeleted)) {
      return c.json({ error: 'deleted files cannot be opened locally' }, 409);
    }

    let realRepoRoot: string;
    let realFilePath: string;
    try {
      [realRepoRoot, realFilePath] = await Promise.all([
        realpath(repoRoot),
        realpath(requestedAbsolutePath)
      ]);
    } catch (error) {
      if (isFileNotFound(error)) {
        return c.json({ error: 'file no longer exists on disk' }, 404);
      }
      throw error;
    }

    if (!isPathWithin(realRepoRoot, realFilePath)) {
      return c.json({ error: 'filePath must stay within the review cwd' }, 400);
    }

    const fileStats = await stat(realFilePath);
    if (!fileStats.isFile()) {
      return c.json({ error: 'path is not a file' }, 409);
    }

    try {
      await openLocalPath(realFilePath);
    } catch (error) {
      return c.json({ error: `could not open file: ${formatError(error)}` }, 500);
    }

    const response: OpenFileResponse = { ok: true, path: realFilePath };
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
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
    return new Response('Not found', { status: 404 });
  }
}

async function serveIndex() {
  try {
    const body = await readFile(path.join(webRoot, 'index.html'));
    return new Response(body, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
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
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }
      return new Response(`${fileName} is missing. Run pnpm build.`, { status: 404 });
    }
  };
}

async function readJsonBody<T>(
  c: Context,
  guard: JsonGuard<T>,
  label: string
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  let body: JsonValue;
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

function isPathWithin(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
