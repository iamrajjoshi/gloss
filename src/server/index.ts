import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { formatError, isFileNotFound } from '../shared/errors';
import { captureCommitRangeDiff, captureDiffContext } from '../shared/git-diff';
import type { JsonValue } from '../shared/json';
import { globalStateDir, packageVersion, protocolVersion } from '../shared/paths';
import type {
  AgentClaimRequest,
  AgentNoteRequest,
  ClearReviewsRequest,
  CommitRangeDiffResponse,
  CreateReviewResponse,
  CreateReviewTurnResponse,
  DiffContextRequest,
  DiffContextSource,
  DiffFile,
  DiffPayload,
  FileContentResponse,
  HealthResponse,
  ListReviewsResponse,
  OpenFileResponse,
  OpenFileTargetsResponse,
  OpenResult,
  ResolutionRequest,
  ReviewEvent,
  ReviewMeta,
  ReviewTurnSummary,
  SourcePeekRangeRequest,
  SourcePeekRequest,
  SubmitReviewRequest
} from '../shared/types';
import { DIFF_CONTEXT_MAX_LINES } from '../shared/types';
import {
  isAgentClaimRequest,
  isAgentNoteRequest,
  isClearReviewsRequest,
  isCommitRangeDiffRequest,
  isDiffContextRequest,
  isDiffPayload,
  isFileContentRequest,
  isOpenFileRequest,
  isResolutionRequest,
  isSourcePeekRangeRequest,
  isSourcePeekRequest,
  isSubmitReviewRequest,
  type JsonGuard,
  parseJsonValue
} from '../shared/validation';
import { availableOpenFileTargets, openLocalPath } from './local-open';
import { readSourcePeekRange, resolveSourcePeek } from './source-peek';
import { reviewStore } from './store';

const webRoot = fileURLToPath(new URL('../web', import.meta.url));
const eventStreamHeartbeatMs = 15_000;

interface AppOptions {
  onReviewActivity?: () => void;
  registerEventStream?: (close: () => void) => () => void;
  health?: () => Partial<Pick<HealthResponse, 'connections' | 'cwd' | 'daemonPath' | 'stateDir'>>;
}

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

export function createApp(origin: string, options: AppOptions = {}): Hono {
  const app = new Hono();

  app.get('/api/health', async (c) => {
    const reviews = await reviewStore.list();
    const response: HealthResponse = {
      ok: true,
      version: packageVersion,
      protocolVersion,
      activeReviews: reviews.filter((review) => review.status === 'pending').length,
      stateDir: globalStateDir(),
      ...options.health?.()
    };
    return c.json(response);
  });

  app.get('/api/open-targets', async (c) => {
    const response: OpenFileTargetsResponse = { targets: await availableOpenFileTargets() };
    return c.json(response);
  });

  app.get('/api/reviews', async (c) => {
    const response: ListReviewsResponse = { reviews: await reviewStore.list() };
    return c.json(response);
  });

  app.post('/api/maintenance/clear-reviews', async (c) => {
    const parsed = await readJsonBody(c, isClearReviewsRequest, 'clear reviews request');
    if (!parsed.ok) {
      return parsed.response;
    }
    const body: ClearReviewsRequest = parsed.body;
    const result = await reviewStore.clearReviewArtifacts(body);
    return c.json(result);
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
      turn: activeTurnSummary(record.meta),
      url: `${origin}/review/${record.meta.id}`
    };
    options.onReviewActivity?.();
    return c.json(response, 201);
  });

  app.post('/api/reviews/:id/turns', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    const parsed = await readJsonBody(c, isDiffPayload, 'review diff');
    if (!parsed.ok) {
      return parsed.response;
    }
    try {
      const { record, turn, reused } = await reviewStore.appendTurn(id, parsed.body);
      const response: CreateReviewTurnResponse = {
        meta: record.meta,
        turn: turnSummary(record.meta, turn.id),
        url: `${origin}/review/${id}`,
        reused
      };
      options.onReviewActivity?.();
      return c.json(response);
    } catch (error) {
      return c.json({ error: formatError(error) }, 409);
    }
  });

  app.get('/api/reviews/:id', async (c) => {
    const record = await reviewStore.get(c.req.param('id'));
    if (!record) {
      return c.json({ error: 'review not found' }, 404);
    }
    return c.json(record);
  });

  app.get('/api/reviews/:id/turns/:turnId', async (c) => {
    const turn = await reviewStore.getTurn(c.req.param('id'), c.req.param('turnId'));
    if (!turn) {
      return c.json({ error: 'turn not found' }, 404);
    }
    return c.json(turn);
  });

  app.get('/api/reviews/:id/feedback', async (c) => {
    const feedback = await reviewStore.feedback(c.req.param('id'));
    if (!feedback) {
      return c.json({ error: 'feedback not found' }, 404);
    }
    return c.json(feedback);
  });

  app.post('/api/reviews/:id/agent/claim', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    const parsed = await readOptionalJsonBody(c, isAgentClaimRequest, 'agent claim request');
    if (!parsed.ok) {
      return parsed.response;
    }
    const body: AgentClaimRequest = parsed.body;
    try {
      const result = await reviewStore.claim(id, body.message, body.turn);
      options.onReviewActivity?.();
      return c.json(result);
    } catch (error) {
      return c.json({ error: formatError(error) }, statusForStoreError(error));
    }
  });

  app.post('/api/reviews/:id/agent/notes', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    const parsed = await readJsonBody(c, isAgentNoteRequest, 'agent note request');
    if (!parsed.ok) {
      return parsed.response;
    }
    const body: AgentNoteRequest = parsed.body;
    try {
      const result = await reviewStore.addAgentNote(id, body.message, body.status, body.turn);
      options.onReviewActivity?.();
      return c.json(result);
    } catch (error) {
      return c.json({ error: formatError(error) }, statusForStoreError(error));
    }
  });

  app.get('/api/reviews/:id/events', async (c) => {
    const id = c.req.param('id');
    const record = await reviewStore.get(id);
    if (!record) {
      return c.json({ error: 'review not found' }, 404);
    }
    const afterSeq = eventReplayAfterSeq(c);

    return streamSSE(c, async (stream) => {
      let closed = false;
      let replaying = true;
      let lastSentSeq = afterSeq;
      const bufferedEvents: ReviewEvent[] = [];
      let pending: Promise<void> = Promise.resolve();
      let cleanup: (() => void) | null = null;
      let close: (() => void) | null = null;
      let unregisterEventStream: (() => void) | null = null;
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
      unregisterEventStream = options.registerEventStream?.(() => close?.()) ?? null;
      const send = (event: ReviewEvent) => {
        const eventSeq = event.seq ?? 0;
        if (eventSeq > 0 && eventSeq <= lastSentSeq) {
          return;
        }
        if (eventSeq > 0) {
          lastSentSeq = eventSeq;
        }
        pending = pending
          .then(() => {
            const data = JSON.stringify(event);
            return event.seq
              ? stream.writeSSE({ data, id: String(event.seq) })
              : stream.writeSSE({ data });
          })
          .then(() => {
            if (event.type === 'review.cancelled') {
              close?.();
            }
          });
        void pending.catch(() => close?.());
      };
      const unsubscribe = reviewStore.subscribe(id, (event) => {
        if (replaying) {
          bufferedEvents.push(event);
          return;
        }
        send(event);
      });
      const heartbeat = setInterval(() => {
        pending = pending.then(async () => {
          await stream.write(`: keep-alive ${Date.now()}\n\n`);
        });
        void pending.catch(() => close?.());
      }, eventStreamHeartbeatMs);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        unregisterEventStream?.();
        unregisterEventStream = null;
      };
      stream.onAbort(() => close?.());

      for (const event of await reviewStore.events(id, afterSeq)) {
        send(event);
      }
      replaying = false;
      for (const event of bufferedEvents) {
        send(event);
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
    const parsed = await readJsonBody(c, isSubmitReviewRequest, 'submit review request');
    if (!parsed.ok) {
      return parsed.response;
    }
    const body: SubmitReviewRequest = parsed.body;
    let submitted: Awaited<ReturnType<typeof reviewStore.submit>>;
    try {
      submitted = await reviewStore.submit(id, body.comments, body.reviewScope);
    } catch (error) {
      return c.json({ error: formatError(error) }, 409);
    }
    const { feedbackPath, markdownPath, turn } = submitted;
    const response: OpenResult = {
      reviewId: id,
      turnId: turn.id,
      turnIndex: turn.index,
      url: `${origin}/review/${id}`,
      files: turn.diff.files.length,
      comments: body.comments.length,
      artifactDir: turn.artifactDir,
      feedbackPath,
      markdownPath
    };
    options.onReviewActivity?.();
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

    const requestedTurnId = parsed.body.turnId;
    const turn = requestedTurnId ? await reviewStore.getTurn(id, requestedTurnId) : null;
    if (requestedTurnId && !turn) {
      return c.json({ error: 'turn not found' }, 404);
    }
    const diffPayload = turn?.diff ?? existing.diff;
    const commitDiffs = diffPayload.commitDiffs ?? [];
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
        : await captureCommitRangeDiff(fromSha, toSha, diffPayload.cwd);
    const response: CommitRangeDiffResponse = {
      fromSha,
      toSha,
      stats: diff.stats,
      rawDiff: diff.rawDiff,
      files: diff.files
    };
    return c.json(response);
  });

  app.post('/api/reviews/:id/files/context', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    const parsed = await readJsonBody(c, isDiffContextRequest, 'diff context request');
    if (!parsed.ok) {
      return parsed.response;
    }

    const body: DiffContextRequest = parsed.body;
    if (body.lineCount > DIFF_CONTEXT_MAX_LINES) {
      return c.json({ error: `lineCount must be ${DIFF_CONTEXT_MAX_LINES} or less` }, 400);
    }

    const turn = body.turnId ? await reviewStore.getTurn(id, body.turnId) : null;
    if (body.turnId && !turn) {
      return c.json({ error: 'turn not found' }, 404);
    }
    const diffPayload = turn?.diff ?? existing.diff;
    const repoRoot = path.resolve(diffPayload.cwd);
    const pathError =
      validateContextPath(repoRoot, body.filePath, 'filePath') ??
      (body.oldPath ? validateContextPath(repoRoot, body.oldPath, 'oldPath') : null);
    if (pathError) {
      return c.json({ error: pathError }, 400);
    }

    const source = await resolveContextSource(diffPayload, body.source);
    if (!source.ok) {
      return c.json({ error: source.error }, source.status);
    }

    const reviewFile = source.files.find((file) => file.path === body.filePath);
    if (!reviewFile) {
      return c.json({ error: 'file is not part of this review context' }, 404);
    }
    if ((reviewFile.oldPath ?? null) !== body.oldPath) {
      return c.json({ error: 'oldPath does not match the reviewed file' }, 400);
    }
    if (reviewFile.isBinary) {
      return c.json({ error: 'binary file context is not available' }, 409);
    }

    try {
      const response = await captureDiffContext({
        filePath: body.filePath,
        oldPath: body.oldPath,
        oldRef: source.oldRef,
        newRef: source.newRef,
        oldStart: body.oldStart,
        newStart: body.newStart,
        lineCount: body.lineCount,
        repoRoot
      });
      return c.json(response);
    } catch (error) {
      return c.json({ error: `context is unavailable: ${formatError(error)}` }, 409);
    }
  });

  app.post('/api/reviews/:id/source-peek', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    const parsed = await readJsonBody(c, isSourcePeekRequest, 'source peek request');
    if (!parsed.ok) {
      return parsed.response;
    }

    const body: SourcePeekRequest = parsed.body;
    const turn = body.turnId ? await reviewStore.getTurn(id, body.turnId) : null;
    if (body.turnId && !turn) {
      return c.json({ error: 'turn not found' }, 404);
    }
    const diffPayload = turn?.diff ?? existing.diff;
    const repoRoot = path.resolve(diffPayload.cwd);
    const pathError =
      validateContextPath(repoRoot, body.filePath, 'filePath') ??
      (body.oldPath ? validateContextPath(repoRoot, body.oldPath, 'oldPath') : null);
    if (pathError) {
      return c.json({ error: pathError }, 400);
    }

    const source = await resolveContextSource(diffPayload, body.source);
    if (!source.ok) {
      return c.json({ error: source.error }, source.status);
    }

    const reviewFile = source.files.find((file) => file.path === body.filePath);
    if (!reviewFile) {
      return c.json({ error: 'file is not part of this review context' }, 404);
    }
    if ((reviewFile.oldPath ?? null) !== body.oldPath) {
      return c.json({ error: 'oldPath does not match the reviewed file' }, 400);
    }
    if (reviewFile.isBinary) {
      return c.json({ error: 'binary file source peek is not available' }, 409);
    }
    if (body.side === 'L' && reviewFile.isNew) {
      return c.json({ error: 'new files do not have an old-side source' }, 409);
    }
    if (body.side === 'R' && reviewFile.isDeleted) {
      return c.json({ error: 'deleted files do not have a new-side source' }, 409);
    }

    const sourceFilePath = body.side === 'L' ? (body.oldPath ?? body.filePath) : body.filePath;
    const sourceRef = body.side === 'L' ? source.oldRef : source.newRef;
    try {
      return c.json(
        await resolveSourcePeek({
          repoRoot,
          sourceFilePath,
          sourceRef,
          symbol: body.symbol,
          line: body.line,
          column: body.column
        })
      );
    } catch (error) {
      return c.json({ error: `source peek unavailable: ${formatError(error)}` }, 404);
    }
  });

  app.post('/api/reviews/:id/source-peek/range', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    const parsed = await readJsonBody(c, isSourcePeekRangeRequest, 'source peek range request');
    if (!parsed.ok) {
      return parsed.response;
    }

    const body: SourcePeekRangeRequest = parsed.body;
    const turn = body.turnId ? await reviewStore.getTurn(id, body.turnId) : null;
    if (body.turnId && !turn) {
      return c.json({ error: 'turn not found' }, 404);
    }
    const diffPayload = turn?.diff ?? existing.diff;
    const repoRoot = path.resolve(diffPayload.cwd);
    const pathError = validateContextPath(repoRoot, body.filePath, 'filePath');
    if (pathError) {
      return c.json({ error: pathError }, 400);
    }

    const source = await resolveContextSource(diffPayload, body.source);
    if (!source.ok) {
      return c.json({ error: source.error }, source.status);
    }

    const sourceRef = body.side === 'L' ? source.oldRef : source.newRef;
    try {
      return c.json(
        await readSourcePeekRange({
          repoRoot,
          sourceFilePath: body.filePath,
          sourceRef,
          startLine: body.startLine,
          lineCount: body.lineCount
        })
      );
    } catch (error) {
      return c.json({ error: `source range unavailable: ${formatError(error)}` }, 404);
    }
  });

  app.post('/api/reviews/:id/files/content', async (c) => {
    const id = c.req.param('id');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    const parsed = await readJsonBody(c, isFileContentRequest, 'file content request');
    if (!parsed.ok) {
      return parsed.response;
    }

    const { filePath, scope = 'review', turnId } = parsed.body;
    if (!filePath || filePath.includes('\0') || path.isAbsolute(filePath)) {
      return c.json({ error: 'filePath must be a repo-relative path' }, 400);
    }

    const repoRoot = path.resolve(existing.diff.cwd);
    const requestedAbsolutePath = path.resolve(repoRoot, filePath);
    if (!isPathWithin(repoRoot, requestedAbsolutePath)) {
      return c.json({ error: 'filePath must stay within the review cwd' }, 400);
    }

    const turn = turnId ? await reviewStore.getTurn(id, turnId) : null;
    if (turnId && !turn) {
      return c.json({ error: 'turn not found' }, 404);
    }

    if (scope === 'review') {
      const diffPayload = turn?.diff ?? existing.diff;
      const reviewFiles = [
        ...diffPayload.files,
        ...(diffPayload.commitDiffs ?? []).flatMap((commitDiff) => commitDiff.files)
      ].filter((file) => file.path === filePath);
      if (reviewFiles.length === 0) {
        return c.json({ error: 'file is not part of this review' }, 404);
      }
      if (reviewFiles.every((file) => file.isDeleted)) {
        return c.json({ error: 'deleted files cannot be copied' }, 409);
      }
      if (reviewFiles.some((file) => file.isBinary)) {
        return c.json({ error: 'binary file contents cannot be copied' }, 409);
      }
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

    const response: FileContentResponse = {
      content: await readFile(realFilePath, 'utf8'),
      filePath
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

    const { filePath, scope = 'review', target, turnId } = parsed.body;
    if (!filePath || filePath.includes('\0') || path.isAbsolute(filePath)) {
      return c.json({ error: 'filePath must be a repo-relative path' }, 400);
    }

    const repoRoot = path.resolve(existing.diff.cwd);
    const requestedAbsolutePath = path.resolve(repoRoot, filePath);
    if (!isPathWithin(repoRoot, requestedAbsolutePath)) {
      return c.json({ error: 'filePath must stay within the review cwd' }, 400);
    }

    const turn = turnId ? await reviewStore.getTurn(id, turnId) : null;
    if (turnId && !turn) {
      return c.json({ error: 'turn not found' }, 404);
    }

    if (scope === 'review') {
      const diffPayload = turn?.diff ?? existing.diff;
      const reviewFiles = [
        ...diffPayload.files,
        ...(diffPayload.commitDiffs ?? []).flatMap((commitDiff) => commitDiff.files)
      ].filter((file) => file.path === filePath);
      if (reviewFiles.length === 0) {
        return c.json({ error: 'file is not part of this review' }, 404);
      }
      if (reviewFiles.every((file) => file.isDeleted)) {
        return c.json({ error: 'deleted files cannot be opened locally' }, 409);
      }
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
      target ? await openLocalPath(realFilePath, target) : await openLocalPath(realFilePath);
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
    const parsed = await readJsonBody(c, isResolutionRequest, 'resolution request');
    if (!parsed.ok) {
      return parsed.response;
    }
    const body: ResolutionRequest = parsed.body;
    try {
      const result = await reviewStore.markResolved(id, body.summary, body.turn);
      options.onReviewActivity?.();
      return c.json(result);
    } catch (error) {
      return c.json({ error: formatError(error) }, statusForStoreError(error));
    }
  });

  app.post('/api/reviews/:id/comments/:commentId/resolved', async (c) => {
    const id = c.req.param('id');
    const commentId = c.req.param('commentId');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    const parsed = await readJsonBody(c, isResolutionRequest, 'resolution request');
    if (!parsed.ok) {
      return parsed.response;
    }
    const body: ResolutionRequest = parsed.body;
    try {
      const result = await reviewStore.resolveComment(id, commentId, body.summary);
      options.onReviewActivity?.();
      return c.json(result);
    } catch (error) {
      return c.json({ error: formatError(error) }, statusForStoreError(error));
    }
  });

  app.delete('/api/reviews/:id/comments/:commentId/resolved', async (c) => {
    const id = c.req.param('id');
    const commentId = c.req.param('commentId');
    const existing = await reviewStore.get(id);
    if (!existing) {
      return c.json({ error: 'review not found' }, 404);
    }
    try {
      const result = await reviewStore.reopenComment(id, commentId);
      options.onReviewActivity?.();
      return c.json(result);
    } catch (error) {
      return c.json({ error: formatError(error) }, statusForStoreError(error));
    }
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

function eventReplayAfterSeq(c: Context): number {
  const url = new URL(c.req.url);
  const rawAfter = url.searchParams.get('after') ?? c.req.header('last-event-id') ?? '0';
  const afterSeq = Number(rawAfter);
  return Number.isInteger(afterSeq) && afterSeq > 0 ? afterSeq : 0;
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

async function readOptionalJsonBody<T>(
  c: Context,
  guard: JsonGuard<T>,
  label: string
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  let raw: string;
  try {
    raw = await c.req.text();
  } catch (error) {
    return {
      ok: false,
      response: c.json({ error: `invalid JSON body: ${formatError(error)}` }, 400)
    };
  }
  let body: JsonValue;
  try {
    body = raw.trim().length > 0 ? JSON.parse(raw) : {};
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

type ContextSourceResolution =
  | {
      ok: true;
      files: DiffFile[];
      oldRef: string | null;
      newRef: string | null;
    }
  | { ok: false; status: 400 | 404 | 409; error: string };

async function resolveContextSource(
  diffPayload: DiffPayload,
  source: DiffContextSource
): Promise<ContextSourceResolution> {
  if (source.mode === 'turn') {
    return {
      ok: true,
      files: diffPayload.files,
      oldRef: diffPayload.base.sha,
      newRef: diffPayload.scope.comparison.sha
    };
  }

  const commitDiffs = diffPayload.commitDiffs ?? [];
  if (commitDiffs.length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'commit context is only available for branch reviews'
    };
  }

  if (source.mode === 'commit') {
    const commitDiff = commitDiffs.find((diff) => diff.commit.sha === source.sha);
    if (!commitDiff) {
      return { ok: false, status: 404, error: 'commit must be part of this review' };
    }
    return {
      ok: true,
      files: commitDiff.files,
      oldRef: `${source.sha}^`,
      newRef: source.sha
    };
  }

  const fromIndex = commitDiffs.findIndex((diff) => diff.commit.sha === source.fromSha);
  const toIndex = commitDiffs.findIndex((diff) => diff.commit.sha === source.toSha);
  if (fromIndex < 0 || toIndex < 0) {
    return { ok: false, status: 404, error: 'commit range must use commits from this review' };
  }
  if (fromIndex > toIndex) {
    return { ok: false, status: 400, error: 'fromSha must come before or match toSha' };
  }

  const rangeDiff =
    source.fromSha === source.toSha
      ? commitDiffs[fromIndex]
      : await captureCommitRangeDiff(source.fromSha, source.toSha, diffPayload.cwd);
  return {
    ok: true,
    files: rangeDiff.files,
    oldRef: `${source.fromSha}^`,
    newRef: source.toSha
  };
}

function validateContextPath(repoRoot: string, filePath: string, label: string): string | null {
  if (!filePath || filePath.includes('\0') || path.isAbsolute(filePath)) {
    return `${label} must be a repo-relative path`;
  }

  const requestedAbsolutePath = path.resolve(repoRoot, filePath);
  if (!isPathWithin(repoRoot, requestedAbsolutePath)) {
    return `${label} must stay within the review cwd`;
  }

  return null;
}

function activeTurnSummary(meta: ReviewMeta): ReviewTurnSummary {
  if (!meta.activeTurnId) {
    throw new Error(`Review ${meta.id} has no active turn`);
  }
  return turnSummary(meta, meta.activeTurnId);
}

function turnSummary(meta: ReviewMeta, turnId: string): ReviewTurnSummary {
  const summary = meta.turns?.find((turn) => turn.id === turnId);
  if (!summary) {
    throw new Error(`Review ${meta.id} is missing turn ${turnId}`);
  }
  return summary;
}

function statusForStoreError(error: unknown): 404 | 409 {
  return /not found/i.test(formatError(error)) ? 404 : 409;
}
