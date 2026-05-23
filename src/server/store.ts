import type { Dirent } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { ulid } from 'ulid';
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
import type {
  Comment,
  DiffPayload,
  FeedbackBundle,
  ReviewEvent,
  ReviewMeta,
  ReviewRecord
} from '../shared/types';

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
    const timestamp = new Date().toISOString();
    const feedback: FeedbackBundle = {
      version: 1,
      reviewId: id,
      timestamp,
      base: record.diff.base,
      branch: record.diff.branch,
      comments: [...comments].sort(
        (a, b) =>
          a.filePath.localeCompare(b.filePath) ||
          a.startLine - b.startLine ||
          a.endLine - b.endLine ||
          a.side.localeCompare(b.side)
      )
    };
    record.feedback = feedback;
    record.meta = { ...record.meta, status: 'completed', completedAt: timestamp };
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
      writeFile(globalReviewMetaFile(id), `${JSON.stringify(record.meta, null, 2)}\n`),
      writeFile(feedbackPath, `${JSON.stringify(feedback, null, 2)}\n`),
      writeFile(markdownPath, serializeFeedbackMarkdown(feedback))
    ]);

    this.emit({
      type: 'review.completed',
      reviewId: id,
      counts: {
        files: new Set(feedback.comments.map((comment) => comment.filePath)).size,
        comments: feedback.comments.length
      }
    });
    return { record, feedbackPath, markdownPath };
  }

  async feedback(id: string): Promise<FeedbackBundle | null> {
    const record = await this.get(id);
    return record?.feedback ?? null;
  }

  async markResolved(id: string, summary?: string): Promise<string> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    const resolvedAt = new Date().toISOString();
    const resolvedPath = globalReviewResolvedFile(id);
    record.meta = { ...record.meta, status: 'resolved', resolvedAt };
    this.reviews.set(id, record);
    await ensureDir(globalReviewDir(id));
    await writeFile(
      resolvedPath,
      `${JSON.stringify({ reviewId: id, summary: summary ?? null, resolvedAt }, null, 2)}\n`
    );
    await writeFile(globalReviewMetaFile(id), `${JSON.stringify(record.meta, null, 2)}\n`);
    return resolvedPath;
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
      writeFile(globalReviewMetaFile(record.meta.id), `${JSON.stringify(record.meta, null, 2)}\n`),
      writeFile(globalReviewDiffFile(record.meta.id), `${JSON.stringify(record.diff, null, 2)}\n`)
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
    } catch {
      return;
    }

    await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => this.loadReview(entry.name))
    );
  }

  private async loadReview(id: string): Promise<ReviewRecord | null> {
    try {
      const [metaRaw, diffRaw] = await Promise.all([
        readFile(globalReviewMetaFile(id), 'utf8'),
        readFile(globalReviewDiffFile(id), 'utf8')
      ]);
      const meta = JSON.parse(metaRaw) as ReviewMeta;
      const diff = JSON.parse(diffRaw) as DiffPayload;
      let feedback: FeedbackBundle | undefined;
      try {
        feedback = JSON.parse(
          await readFile(globalReviewFeedbackFile(id), 'utf8')
        ) as FeedbackBundle;
      } catch {
        feedback = undefined;
      }

      const record: ReviewRecord = {
        meta: {
          ...meta,
          artifactDir: meta.artifactDir ?? globalReviewDir(id),
          feedbackPath: meta.feedbackPath ?? (feedback ? globalReviewFeedbackFile(id) : undefined),
          markdownPath: meta.markdownPath ?? (feedback ? globalReviewMarkdownFile(id) : undefined)
        },
        diff,
        feedback
      };
      this.reviews.set(id, record);
      return record;
    } catch {
      return null;
    }
  }
}

export const reviewStore = new ReviewStore();

export async function removeReviewArtifacts(_cwd: string, id: string): Promise<void> {
  await rm(globalReviewDir(id), { force: true, recursive: true });
}
