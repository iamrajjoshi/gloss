import type { Dirent } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { ulid } from 'ulid';
import { compareCommentsByLocation, countCommentFiles, resolutionCounts } from '../shared/comments';
import { formatError, isFileNotFound } from '../shared/errors';
import { writeJsonFile } from '../shared/json';
import { serializeFeedbackMarkdown } from '../shared/markdown';
import {
  ensureDir,
  globalReviewDiffFile,
  globalReviewDir,
  globalReviewFeedbackFile,
  globalReviewMarkdownFile,
  globalReviewMetaFile,
  globalReviewResolvedFile,
  globalReviewsDir
} from '../shared/paths';
import { isResolvableReviewStatus } from '../shared/reviews';
import type {
  Comment,
  DiffPayload,
  FeedbackBundle,
  ResolutionBundle,
  ResolvedComment,
  ResolveResult,
  ReviewEvent,
  ReviewMeta,
  ReviewRecord,
  ReviewUpdateReason
} from '../shared/types';
import {
  isDiffPayload,
  isFeedbackBundle,
  isResolutionBundle,
  isStoredReviewMeta,
  type JsonGuard,
  parseJson
} from '../shared/validation';

type Listener = (event: ReviewEvent) => void;

export class ReviewStore {
  private readonly reviews = new Map<string, ReviewRecord>();
  private readonly listeners = new Map<string, Set<Listener>>();

  async create(diff: DiffPayload): Promise<ReviewRecord> {
    const id = ulid();
    const createdAt = new Date().toISOString();
    const meta: ReviewMeta = {
      id,
      cwd: diff.cwd,
      base: diff.base,
      branch: diff.branch,
      status: 'pending',
      createdAt,
      artifactDir: globalReviewDir(id)
    };
    const record: ReviewRecord = { meta, diff };
    this.reviews.set(id, record);
    await this.persistInitial(record);
    this.emit({ type: 'review.opened', reviewId: id });
    return record;
  }

  async list(): Promise<ReviewMeta[]> {
    await this.loadAllReviews();
    return [...this.reviews.values()]
      .map((record) => record.meta)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<ReviewRecord | null> {
    return this.reviews.get(id) ?? (await this.loadKnownReview(id));
  }

  async submit(
    id: string,
    comments: Comment[]
  ): Promise<{ record: ReviewRecord; feedbackPath: string; markdownPath: string }> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    if (record.meta.status !== 'pending') {
      throw new Error(`Review ${id} is ${record.meta.status} and cannot be submitted`);
    }
    const timestamp = new Date().toISOString();
    const feedback: FeedbackBundle = {
      version: 1,
      reviewId: id,
      timestamp,
      base: record.diff.base,
      branch: record.diff.branch,
      comments: [...comments].sort(compareCommentsByLocation)
    };
    record.feedback = feedback;
    record.meta = { ...record.meta, status: 'submitted', submittedAt: timestamp };
    this.reviews.set(id, record);

    const artifactDir = globalReviewDir(id);
    const feedbackPath = globalReviewFeedbackFile(id);
    const markdownPath = globalReviewMarkdownFile(id);
    record.meta = {
      ...record.meta,
      artifactDir,
      feedbackPath,
      markdownPath
    };
    await ensureDir(artifactDir);
    await Promise.all([
      writeJsonFile(globalReviewMetaFile(id), record.meta),
      writeJsonFile(feedbackPath, feedback),
      writeFile(markdownPath, serializeFeedbackMarkdown(feedback))
    ]);

    this.emit({
      type: 'review.submitted',
      reviewId: id,
      counts: {
        files: countCommentFiles(feedback.comments),
        comments: feedback.comments.length
      }
    });
    return { record, feedbackPath, markdownPath };
  }

  async feedback(id: string): Promise<FeedbackBundle | null> {
    const record = await this.get(id);
    return record?.feedback ?? null;
  }

  async markResolved(id: string, summary?: string): Promise<ResolveResult> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    this.assertResolvable(record, id);
    const resolvedAt = new Date().toISOString();
    const existingById = new Map(
      (record.resolution?.comments ?? []).map((comment) => [comment.commentId, comment])
    );
    const comments = this.sortResolvedComments(
      (record.feedback?.comments ?? []).map((comment) => ({
        ...existingById.get(comment.id),
        commentId: comment.id,
        status: 'resolved' as const,
        resolvedAt: existingById.get(comment.id)?.resolvedAt ?? resolvedAt
      })),
      record
    );
    const resolution: ResolutionBundle = {
      reviewId: id,
      status: 'resolved',
      summary: summary ?? record.resolution?.summary ?? null,
      resolvedAt,
      comments
    };
    record.meta = { ...record.meta, status: 'resolved', resolvedAt };
    return this.persistResolution(record, resolution, 'review-resolved');
  }

  async resolveComment(id: string, commentId: string, summary?: string): Promise<ResolveResult> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    this.assertResolvable(record, id);
    this.assertCommentExists(record, commentId);

    const resolvedAt = new Date().toISOString();
    const previous = record.resolution?.comments.find((comment) => comment.commentId === commentId);
    const nextSummary = summary ?? previous?.summary;
    const nextComment: ResolvedComment = {
      commentId,
      status: 'resolved',
      ...(nextSummary ? { summary: nextSummary } : {}),
      resolvedAt
    };
    const comments = this.sortResolvedComments(
      [
        ...(record.resolution?.comments ?? []).filter((comment) => comment.commentId !== commentId),
        nextComment
      ],
      record
    );
    const counts = resolutionCounts(record.feedback, comments);
    const fullyResolved = counts.total === counts.resolved;
    const resolution: ResolutionBundle = {
      reviewId: id,
      status: fullyResolved ? 'resolved' : 'partial',
      summary: fullyResolved ? (record.resolution?.summary ?? null) : null,
      resolvedAt: fullyResolved ? resolvedAt : null,
      comments
    };
    record.meta = fullyResolved
      ? { ...record.meta, status: 'resolved', resolvedAt }
      : { ...record.meta, status: 'submitted', resolvedAt: undefined };
    return this.persistResolution(record, resolution, 'comment-resolved');
  }

  async reopenComment(id: string, commentId: string): Promise<ResolveResult> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    this.assertResolvable(record, id);
    this.assertCommentExists(record, commentId);

    const comments = this.sortResolvedComments(
      (record.resolution?.comments ?? []).filter((comment) => comment.commentId !== commentId),
      record
    );
    const counts = resolutionCounts(record.feedback, comments);
    const fullyResolved = counts.total > 0 && counts.total === counts.resolved;
    const resolvedAt = fullyResolved ? new Date().toISOString() : null;
    const resolution: ResolutionBundle = {
      reviewId: id,
      status: fullyResolved ? 'resolved' : 'partial',
      summary: fullyResolved ? (record.resolution?.summary ?? null) : null,
      resolvedAt,
      comments
    };
    record.meta = fullyResolved
      ? { ...record.meta, status: 'resolved', resolvedAt: resolvedAt ?? undefined }
      : { ...record.meta, status: 'submitted', resolvedAt: undefined };
    return this.persistResolution(record, resolution, 'comment-reopened');
  }

  subscribe(reviewId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(reviewId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(reviewId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(reviewId);
      }
    };
  }

  private emit(event: ReviewEvent): void {
    for (const listener of this.listeners.get(event.reviewId) ?? []) {
      listener(event);
    }
  }

  private async persistInitial(record: ReviewRecord): Promise<void> {
    const dir = globalReviewDir(record.meta.id);
    await ensureDir(dir);
    await Promise.all([
      writeJsonFile(globalReviewMetaFile(record.meta.id), record.meta),
      writeJsonFile(globalReviewDiffFile(record.meta.id), record.diff)
    ]);
  }

  private async loadKnownReview(id: string): Promise<ReviewRecord | null> {
    const existing = this.reviews.get(id);
    if (existing) {
      return existing;
    }

    return this.loadReview(id);
  }

  private async loadAllReviews(): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(globalReviewsDir(), { withFileTypes: true });
    } catch (error) {
      if (isFileNotFound(error)) {
        return;
      }
      throw new Error(
        `Could not read reviews directory at ${globalReviewsDir()}: ${formatError(error)}`,
        {
          cause: error
        }
      );
    }

    await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => this.loadReview(entry.name))
    );
  }

  private async loadReview(id: string): Promise<ReviewRecord | null> {
    const metaPath = globalReviewMetaFile(id);
    const diffPath = globalReviewDiffFile(id);
    let metaRaw: string;
    let diffRaw: string;

    try {
      [metaRaw, diffRaw] = await Promise.all([
        readFile(metaPath, 'utf8'),
        readFile(diffPath, 'utf8')
      ]);
    } catch (error) {
      if (isFileNotFound(error)) {
        return null;
      }
      throw new Error(`Could not load review ${id}: ${formatError(error)}`, { cause: error });
    }

    const meta = parseJsonFile(metaRaw, isStoredReviewMeta, 'review metadata', metaPath);
    const diff = parseJsonFile(diffRaw, isDiffPayload, 'review diff', diffPath);
    const feedback = await readOptionalJsonFile(
      globalReviewFeedbackFile(id),
      isFeedbackBundle,
      'review feedback'
    );
    const resolution = await readOptionalJsonFile(
      globalReviewResolvedFile(id),
      isResolutionBundle,
      'review resolution'
    );

    const record: ReviewRecord = {
      meta: {
        ...meta,
        artifactDir: meta.artifactDir ?? globalReviewDir(id),
        feedbackPath: meta.feedbackPath ?? (feedback ? globalReviewFeedbackFile(id) : undefined),
        markdownPath: meta.markdownPath ?? (feedback ? globalReviewMarkdownFile(id) : undefined)
      },
      diff,
      feedback,
      resolution
    };
    this.reviews.set(id, record);
    return record;
  }

  private assertResolvable(
    record: ReviewRecord,
    id: string
  ): asserts record is ReviewRecord & {
    feedback: FeedbackBundle;
  } {
    if (!isResolvableReviewStatus(record.meta.status)) {
      throw new Error(`Review ${id} is ${record.meta.status} and cannot be resolved`);
    }
    if (!record.feedback) {
      throw new Error(`Review ${id} has no submitted feedback`);
    }
  }

  private assertCommentExists(
    record: ReviewRecord & { feedback: FeedbackBundle },
    commentId: string
  ): void {
    if (!record.feedback.comments.some((comment) => comment.id === commentId)) {
      throw new Error(`Comment ${commentId} not found`);
    }
  }

  private async persistResolution(
    record: ReviewRecord & { feedback: FeedbackBundle },
    resolution: ResolutionBundle,
    reason: ReviewUpdateReason
  ): Promise<ResolveResult> {
    record.resolution = resolution;
    this.reviews.set(record.meta.id, record);
    const resolvedPath = globalReviewResolvedFile(record.meta.id);
    await ensureDir(globalReviewDir(record.meta.id));
    await Promise.all([
      writeJsonFile(resolvedPath, resolution),
      writeJsonFile(globalReviewMetaFile(record.meta.id), record.meta)
    ]);
    const result: ResolveResult = {
      ok: true,
      reviewId: record.meta.id,
      status: record.meta.status,
      resolutionStatus: resolution.status,
      comments: resolutionCounts(record.feedback, resolution.comments),
      path: resolvedPath,
      resolution
    };
    this.emit({
      type: 'review.updated',
      reviewId: record.meta.id,
      reason,
      status: result.status,
      resolutionStatus: result.resolutionStatus,
      counts: result.comments
    });
    return result;
  }

  private sortResolvedComments(
    comments: ResolvedComment[],
    record: ReviewRecord & { feedback: FeedbackBundle }
  ): ResolvedComment[] {
    const feedbackIndex = new Map(
      record.feedback.comments.map((comment, index) => [comment.id, index] as const)
    );
    return comments
      .map((comment) => ({ comment, index: feedbackIndex.get(comment.commentId) }))
      .filter(
        (entry): entry is { comment: ResolvedComment; index: number } => entry.index !== undefined
      )
      .sort((a, b) => a.index - b.index)
      .map(({ comment }) => comment);
  }
}

async function readOptionalJsonFile<T>(
  filePath: string,
  guard: JsonGuard<T>,
  label: string
): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw new Error(`Could not read ${label} at ${filePath}: ${formatError(error)}`, {
      cause: error
    });
  }

  return parseJsonFile(raw, guard, label, filePath);
}

function parseJsonFile<T>(raw: string, guard: JsonGuard<T>, label: string, filePath: string): T {
  try {
    return parseJson(raw, guard, label);
  } catch (error) {
    throw new Error(`Invalid ${label} at ${filePath}: ${formatError(error)}`, { cause: error });
  }
}

export const reviewStore = new ReviewStore();
