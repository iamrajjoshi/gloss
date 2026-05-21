import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import { serializeFeedbackMarkdown } from '../shared/markdown';
import { ensureDir, repoGlossDir, reviewDir } from '../shared/paths';
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
      createdAt
    };
    const record: ReviewRecord = { meta, diff };
    this.reviews.set(id, record);
    await this.persistInitial(record);
    this.emit({ type: 'review.opened', reviewId: id });
    return record;
  }

  list(): ReviewMeta[] {
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

    const dir = reviewDir(record.meta.cwd, id);
    const feedbackPath = path.join(dir, 'feedback.json');
    const markdownPath = path.join(dir, 'feedback.md');
    await ensureDir(dir);
    await Promise.all([
      writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(record.meta, null, 2)}\n`),
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
    const resolvedPath = path.join(reviewDir(record.meta.cwd, id), 'resolved.json');
    await writeFile(
      resolvedPath,
      `${JSON.stringify({ reviewId: id, summary: summary ?? null, resolvedAt: new Date().toISOString() }, null, 2)}\n`
    );
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
    await ensureDir(repoGlossDir(record.meta.cwd));
    await writeFile(path.join(repoGlossDir(record.meta.cwd), '.gitignore'), '*\n!.gitignore\n');
    const dir = reviewDir(record.meta.cwd, record.meta.id);
    await ensureDir(dir);
    await mkdir(path.join(dir, 'original'), { recursive: true });
    await Promise.all([
      writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(record.meta, null, 2)}\n`),
      writeFile(path.join(dir, 'diff.json'), `${JSON.stringify(record.diff, null, 2)}\n`)
    ]);
  }

  private async loadKnownReview(id: string): Promise<ReviewRecord | null> {
    for (const meta of this.reviews.values()) {
      if (meta.meta.id === id) {
        return meta;
      }
    }
    return null;
  }
}

export const reviewStore = new ReviewStore();

export async function removeReviewArtifacts(cwd: string, id: string): Promise<void> {
  await rm(reviewDir(cwd, id), { force: true, recursive: true });
}
