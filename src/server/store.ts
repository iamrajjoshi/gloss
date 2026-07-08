import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import { type ClearReviewArtifactsOptions, clearReviewArtifacts } from '../shared/cleanup';
import { compareCommentsByLocation, countCommentFiles, resolutionCounts } from '../shared/comments';
import { formatError, isFileNotFound } from '../shared/errors';
import { writeJsonFile, writeTextFile } from '../shared/json';
import { serializeFeedbackMarkdown } from '../shared/markdown';
import {
  ensureDir,
  globalReviewDiffFile,
  globalReviewDir,
  globalReviewEventsFile,
  globalReviewFeedbackFile,
  globalReviewMarkdownFile,
  globalReviewMetaFile,
  globalReviewResolvedFile,
  globalReviewsDir,
  globalReviewTurnDiffFile,
  globalReviewTurnDir,
  globalReviewTurnFeedbackFile,
  globalReviewTurnMarkdownFile,
  globalReviewTurnMetaFile,
  globalReviewTurnResolvedFile,
  globalReviewTurnsDir
} from '../shared/paths';
import { normalizeReviewScope, sameReviewScope } from '../shared/review-scope';
import { isResolvableReviewStatus } from '../shared/reviews';
import type {
  AgentClaimResponse,
  AgentNoteResponse,
  AgentStatus,
  ClearReviewsResult,
  Comment,
  DiffPayload,
  FeedbackBundle,
  ResolutionBundle,
  ResolvedComment,
  ResolveResult,
  ReviewEvent,
  ReviewMeta,
  ReviewRecord,
  ReviewScope,
  ReviewTurn,
  ReviewTurnMeta,
  ReviewTurnSummary,
  ReviewUpdateReason
} from '../shared/types';
import {
  isDiffPayload,
  isFeedbackBundle,
  isResolutionBundle,
  isReviewEvent,
  isReviewTurnMeta,
  isStoredReviewMeta,
  type JsonGuard,
  parseJson,
  type StoredReviewMeta
} from '../shared/validation';

type Listener = (event: ReviewEvent) => void;
type ReviewEventInput = ReviewEvent extends infer Event
  ? Event extends ReviewEvent
    ? Omit<Event, 'actor' | 'createdAt' | 'id' | 'seq'>
    : never
  : never;

interface SubmitResult {
  record: ReviewRecord;
  feedbackPath: string;
  markdownPath: string;
  turn: ReviewTurn;
}

interface AppendTurnResult {
  record: ReviewRecord;
  turn: ReviewTurn;
  reused: boolean;
}

export class ReviewStore {
  private readonly reviews = new Map<string, ReviewRecord>();
  private readonly listeners = new Map<string, Set<Listener>>();

  async create(diff: DiffPayload): Promise<ReviewRecord> {
    const id = ulid();
    const createdAt = new Date().toISOString();
    const turn = createTurn(id, 1, diff, createdAt);
    const meta: ReviewMeta = {
      id,
      cwd: diff.cwd,
      base: diff.base,
      branch: diff.branch,
      status: 'pending',
      createdAt,
      artifactDir: globalReviewDir(id),
      activeTurnId: turn.id
    };
    const record = normalizeRecord({ meta, turns: [turn], diff: turn.diff });
    this.reviews.set(id, record);
    await this.persistInitial(record, turn);
    const event = await this.appendReviewEvent(id, 'system', {
      type: 'review.opened',
      reviewId: id
    });
    return withEvents(record, [event]);
  }

  async appendTurn(id: string, diff: DiffPayload): Promise<AppendTurnResult> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    if (record.meta.cwd !== diff.cwd) {
      throw new Error(`Review ${id} belongs to ${record.meta.cwd}, not ${diff.cwd}`);
    }

    const latest = latestTurn(record);
    if (latest.status === 'pending') {
      if (diffFingerprint(latest.diff) === diffFingerprint(diff)) {
        await this.appendReviewEvent(id, 'system', {
          type: 'review.turn.created',
          reviewId: id,
          turnId: latest.id,
          turnIndex: latest.index,
          reused: true
        });
        return {
          record: withEvents(record, await this.readEvents(id)),
          turn: latest,
          reused: true
        };
      }
      throw new Error(`Review ${id} already has a pending turn`);
    }
    if (latest.status === 'cancelled') {
      throw new Error(`Review ${id} is cancelled and cannot be continued`);
    }

    const turn = createTurn(id, latest.index + 1, diff, new Date().toISOString());
    const nextRecord = normalizeRecord({
      ...record,
      meta: { ...record.meta, activeTurnId: turn.id },
      turns: [...record.turns, turn]
    });
    this.reviews.set(id, nextRecord);
    await this.persistInitial(nextRecord, turn);
    await this.appendReviewEvent(id, 'system', {
      type: 'review.turn.created',
      reviewId: id,
      turnId: turn.id,
      turnIndex: turn.index,
      reused: false
    });
    return {
      record: withEvents(nextRecord, await this.readEvents(id)),
      turn,
      reused: false
    };
  }

  async list(): Promise<ReviewMeta[]> {
    await this.loadAllReviews();
    return Array.from(this.reviews.values())
      .map((record) => record.meta)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async clearReviewArtifacts(
    options: ClearReviewArtifactsOptions = {}
  ): Promise<ClearReviewsResult> {
    const result = await clearReviewArtifacts(options);
    if (!result.dryRun) {
      for (const review of result.deleted) {
        this.reviews.delete(review.reviewId);
      }
    }
    return result;
  }

  async get(id: string): Promise<ReviewRecord | null> {
    return this.reviews.get(id) ?? (await this.loadKnownReview(id));
  }

  async getTurn(id: string, turnId: string): Promise<ReviewTurn | null> {
    const record = await this.get(id);
    return record?.turns.find((turn) => turn.id === turnId) ?? null;
  }

  async submit(id: string, comments: Comment[], reviewScope?: ReviewScope): Promise<SubmitResult> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    const turn = activeTurn(record);
    const sortedComments = comments.toSorted(compareCommentsByLocation);
    const normalizedReviewScope = normalizeReviewScope(turn.diff, reviewScope);
    if (turn.status !== 'pending') {
      if (
        turn.feedback &&
        sameComments(turn.feedback.comments, sortedComments) &&
        sameReviewScope(turn.feedback.reviewScope, normalizedReviewScope)
      ) {
        return {
          record,
          feedbackPath: requiredPath(turn.feedbackPath, 'feedback path'),
          markdownPath: requiredPath(turn.markdownPath, 'markdown path'),
          turn
        };
      }
      throw new Error(`Review ${id} turn ${turn.index} is ${turn.status} and cannot be submitted`);
    }

    const timestamp = new Date().toISOString();
    const feedbackPath = globalReviewTurnFeedbackFile(id, turn.id);
    const markdownPath = globalReviewTurnMarkdownFile(id, turn.id);
    const feedback: FeedbackBundle = {
      version: 1,
      reviewId: id,
      turnId: turn.id,
      turnIndex: turn.index,
      timestamp,
      base: turn.diff.base,
      branch: turn.diff.branch,
      reviewScope: normalizedReviewScope,
      comments: sortedComments
    };
    const nextTurn: ReviewTurn = {
      ...turn,
      status: 'submitted',
      submittedAt: timestamp,
      feedbackPath,
      markdownPath,
      feedback
    };
    const nextRecord = normalizeRecord(replaceTurn(record, nextTurn));
    this.reviews.set(id, nextRecord);

    await ensureDir(globalReviewTurnDir(id, nextTurn.id));
    await Promise.all([
      writeJsonFile(globalReviewTurnMetaFile(id, nextTurn.id), turnMeta(nextTurn)),
      writeJsonFile(feedbackPath, feedback),
      writeTextFile(markdownPath, serializeFeedbackMarkdown(feedback))
    ]);
    await this.persistMeta(nextRecord);

    await this.appendReviewEvent(id, 'human', {
      type: 'review.submitted',
      reviewId: id,
      turnId: nextTurn.id,
      turnIndex: nextTurn.index,
      counts: {
        files: countCommentFiles(feedback.comments),
        comments: feedback.comments.length
      }
    });
    return {
      record: withEvents(nextRecord, await this.readEvents(id)),
      feedbackPath,
      markdownPath,
      turn: nextTurn
    };
  }

  async feedback(id: string): Promise<FeedbackBundle | null> {
    const record = await this.get(id);
    return record?.feedback ?? null;
  }

  async events(id: string, afterSeq = 0): Promise<ReviewEvent[]> {
    const record = await this.get(id);
    if (!record) {
      return [];
    }
    return this.readEvents(id, afterSeq);
  }

  async claim(id: string, message?: string, turnSelector?: string): Promise<AgentClaimResponse> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    const turn = turnSelector
      ? this.resolveTurnSelector(record, turnSelector)
      : [...record.turns].reverse().find((candidate) => candidate.status === 'submitted');
    if (!turn) {
      throw new Error(`Review ${id} has no submitted unresolved turn to claim`);
    }
    if (turn.status !== 'submitted') {
      throw new Error(`Review ${id} turn ${turn.index} is ${turn.status} and cannot be claimed`);
    }
    this.assertResolvable(turn, id);
    if (!turn.feedbackPath || !turn.markdownPath) {
      throw new Error(`Review ${id} turn ${turn.index} is missing feedback paths`);
    }
    const event = await this.appendReviewEvent(id, 'agent', {
      type: 'agent.claimed',
      reviewId: id,
      turnId: turn.id,
      turnIndex: turn.index,
      status: 'claimed',
      ...(message ? { message } : {})
    });
    return {
      ok: true,
      reviewId: id,
      turnId: turn.id,
      turnIndex: turn.index,
      status: 'claimed',
      feedbackPath: turn.feedbackPath,
      markdownPath: turn.markdownPath,
      artifactDir: turn.artifactDir,
      feedback: turn.feedback,
      ...(turn.resolution ? { resolution: turn.resolution } : {}),
      event
    };
  }

  async addAgentNote(
    id: string,
    message: string,
    status?: AgentStatus,
    turnSelector?: string
  ): Promise<AgentNoteResponse> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    const turn = turnSelector ? this.resolveTurnSelector(record, turnSelector) : activeTurn(record);
    const event = await this.appendReviewEvent(id, 'agent', {
      type: 'agent.note',
      reviewId: id,
      turnId: turn.id,
      turnIndex: turn.index,
      ...(status ? { status } : {}),
      message
    });
    return {
      ok: true,
      reviewId: id,
      turnId: turn.id,
      turnIndex: turn.index,
      ...(status ? { status } : {}),
      message,
      event
    };
  }

  async markResolved(id: string, summary?: string, turnSelector?: string): Promise<ResolveResult> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    const turn = this.resolveTurnSelector(record, turnSelector);
    this.assertResolvable(turn, id);

    const resolvedAt = new Date().toISOString();
    const existingById = new Map(
      (turn.resolution?.comments ?? []).map((comment) => [comment.commentId, comment])
    );
    const comments = this.sortResolvedComments(
      (turn.feedback?.comments ?? []).map((comment) => ({
        ...existingById.get(comment.id),
        commentId: comment.id,
        status: 'resolved' as const,
        resolvedAt: existingById.get(comment.id)?.resolvedAt ?? resolvedAt
      })),
      turn
    );
    const resolution: ResolutionBundle = {
      reviewId: id,
      turnId: turn.id,
      turnIndex: turn.index,
      status: 'resolved',
      summary: summary ?? turn.resolution?.summary ?? null,
      resolvedAt,
      comments
    };
    const nextTurn: ReviewTurn & { feedback: FeedbackBundle } = {
      ...turn,
      status: 'resolved',
      resolvedAt
    };
    return this.persistResolution(record, nextTurn, resolution, 'review-resolved');
  }

  async resolveComment(id: string, commentId: string, summary?: string): Promise<ResolveResult> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    const turn = this.findTurnForComment(record, commentId);
    if (!turn) {
      const currentTurn = activeTurn(record);
      if (!isResolvableReviewStatus(currentTurn.status)) {
        throw new Error(
          `Review ${id} turn ${currentTurn.index} is ${currentTurn.status} and cannot be resolved`
        );
      }
      throw new Error(`Comment ${commentId} not found`);
    }
    this.assertResolvable(turn, id);

    const resolvedAt = new Date().toISOString();
    const previous = turn.resolution?.comments.find((comment) => comment.commentId === commentId);
    const nextSummary = summary ?? previous?.summary;
    const nextComment: ResolvedComment = {
      commentId,
      status: 'resolved',
      ...(nextSummary ? { summary: nextSummary } : {}),
      resolvedAt
    };
    const comments = this.sortResolvedComments(
      [
        ...(turn.resolution?.comments ?? []).filter((comment) => comment.commentId !== commentId),
        nextComment
      ],
      turn
    );
    const counts = resolutionCounts(turn.feedback, comments);
    const fullyResolved = counts.total === counts.resolved;
    const resolution: ResolutionBundle = {
      reviewId: id,
      turnId: turn.id,
      turnIndex: turn.index,
      status: fullyResolved ? 'resolved' : 'partial',
      summary: fullyResolved ? (turn.resolution?.summary ?? null) : null,
      resolvedAt: fullyResolved ? resolvedAt : null,
      comments
    };
    const nextTurn: ReviewTurn & { feedback: FeedbackBundle } = fullyResolved
      ? { ...turn, status: 'resolved', resolvedAt }
      : { ...turn, status: 'submitted', resolvedAt: undefined };
    return this.persistResolution(record, nextTurn, resolution, 'comment-resolved');
  }

  async reopenComment(id: string, commentId: string): Promise<ResolveResult> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Review ${id} not found`);
    }
    const turn = this.findTurnForComment(record, commentId);
    if (!turn) {
      const currentTurn = activeTurn(record);
      if (!isResolvableReviewStatus(currentTurn.status)) {
        throw new Error(
          `Review ${id} turn ${currentTurn.index} is ${currentTurn.status} and cannot be resolved`
        );
      }
      throw new Error(`Comment ${commentId} not found`);
    }
    this.assertResolvable(turn, id);

    const comments = this.sortResolvedComments(
      (turn.resolution?.comments ?? []).filter((comment) => comment.commentId !== commentId),
      turn
    );
    const counts = resolutionCounts(turn.feedback, comments);
    const fullyResolved = counts.total > 0 && counts.total === counts.resolved;
    const resolvedAt = fullyResolved ? new Date().toISOString() : null;
    const resolution: ResolutionBundle = {
      reviewId: id,
      turnId: turn.id,
      turnIndex: turn.index,
      status: fullyResolved ? 'resolved' : 'partial',
      summary: fullyResolved ? (turn.resolution?.summary ?? null) : null,
      resolvedAt,
      comments
    };
    const nextTurn: ReviewTurn & { feedback: FeedbackBundle } = fullyResolved
      ? { ...turn, status: 'resolved', resolvedAt: resolvedAt ?? undefined }
      : { ...turn, status: 'submitted', resolvedAt: undefined };
    return this.persistResolution(record, nextTurn, resolution, 'comment-reopened');
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

  private async appendReviewEvent(
    reviewId: string,
    actor: NonNullable<ReviewEvent['actor']>,
    input: ReviewEventInput
  ): Promise<ReviewEvent> {
    const persistedEvents = await this.readPersistedEvents(reviewId);
    let existingEvents = persistedEvents ?? [];
    if (!persistedEvents && input.type !== 'review.opened') {
      const record = this.reviews.get(reviewId) ?? (await this.loadKnownReview(reviewId));
      existingEvents = record ? synthesizeReviewEvents(record) : [];
      if (existingEvents.length > 0) {
        await ensureDir(globalReviewDir(reviewId));
        await writeFile(
          globalReviewEventsFile(reviewId),
          `${existingEvents.map((event) => JSON.stringify(event)).join('\n')}\n`
        );
      }
    }
    const event: ReviewEvent = {
      ...input,
      id: ulid(),
      seq: nextEventSeq(existingEvents),
      createdAt: new Date().toISOString(),
      actor
    } as ReviewEvent;
    await ensureDir(globalReviewDir(reviewId));
    await appendFile(globalReviewEventsFile(reviewId), `${JSON.stringify(event)}\n`);
    const record = this.reviews.get(reviewId);
    if (record) {
      this.reviews.set(reviewId, withEvents(record, [...existingEvents, event]));
    }
    this.emit(event);
    return event;
  }

  private async readEvents(reviewId: string, afterSeq = 0): Promise<ReviewEvent[]> {
    const persistedEvents = await this.readPersistedEvents(reviewId);
    if (!persistedEvents) {
      const record = this.reviews.get(reviewId) ?? (await this.loadKnownReview(reviewId));
      if (!record) {
        return [];
      }
      const synthesized = synthesizeReviewEvents(record);
      if (synthesized.length > 0) {
        await ensureDir(globalReviewDir(reviewId));
        await writeFile(
          globalReviewEventsFile(reviewId),
          `${synthesized.map((event) => JSON.stringify(event)).join('\n')}\n`
        );
      }
      this.reviews.set(reviewId, withEvents(record, synthesized));
      return synthesized.filter((event) => (event.seq ?? 0) > afterSeq);
    }

    return persistedEvents.filter((event) => (event.seq ?? 0) > afterSeq);
  }

  private async readPersistedEvents(reviewId: string): Promise<ReviewEvent[] | null> {
    let raw: string;
    try {
      raw = await readFile(globalReviewEventsFile(reviewId), 'utf8');
    } catch (error) {
      if (isFileNotFound(error)) {
        return null;
      }
      throw new Error(`Could not read review events for ${reviewId}: ${formatError(error)}`, {
        cause: error
      });
    }

    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) =>
        parseJsonFile(line, isReviewEvent, 'review event', globalReviewEventsFile(reviewId))
      )
      .filter((event) => event.reviewId === reviewId);
  }

  private emit(event: ReviewEvent): void {
    for (const listener of this.listeners.get(event.reviewId) ?? []) {
      listener(event);
    }
  }

  private async persistInitial(record: ReviewRecord, turn: ReviewTurn): Promise<void> {
    await ensureDir(turn.artifactDir);
    await Promise.all([
      writeJsonFile(globalReviewTurnMetaFile(record.meta.id, turn.id), turnMeta(turn)),
      writeJsonFile(turn.diffPath, turn.diff)
    ]);
    await this.persistMeta(record);
  }

  private async persistMeta(record: ReviewRecord): Promise<void> {
    await ensureDir(globalReviewDir(record.meta.id));
    await writeJsonFile(globalReviewMetaFile(record.meta.id), record.meta);
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

    const reviewLoads: Array<Promise<ReviewRecord | null>> = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        reviewLoads.push(this.loadReviewForList(entry.name));
      }
    }
    await Promise.all(reviewLoads);
  }

  private async loadReviewForList(id: string): Promise<ReviewRecord | null> {
    try {
      return await this.loadReview(id);
    } catch (error) {
      process.stderr.write(`Warning: Skipping corrupt review ${id}: ${formatError(error)}\n`);
      return null;
    }
  }

  private async loadReview(id: string): Promise<ReviewRecord | null> {
    const metaPath = globalReviewMetaFile(id);
    let metaRaw: string;

    try {
      metaRaw = await readFile(metaPath, 'utf8');
    } catch (error) {
      if (isFileNotFound(error)) {
        return this.loadReviewFromTurnsOnly(id);
      }
      throw new Error(`Could not load review ${id}: ${formatError(error)}`, { cause: error });
    }

    const storedMeta = parseJsonFile(metaRaw, isStoredReviewMeta, 'review metadata', metaPath);
    const persistedTurns = await this.loadPersistedTurns(id);
    const legacyTurn = await this.loadLegacyTurn(id, storedMeta);
    const turns = mergeRecoveredTurns(legacyTurn, persistedTurns);
    if (turns.length === 0) {
      throw new Error(`Review ${id} has no recoverable turns`);
    }

    const latest = latestTurn({ turns } as ReviewRecord);
    const record = normalizeRecord({
      meta: {
        ...storedMeta,
        artifactDir: storedMeta.artifactDir ?? globalReviewDir(id),
        activeTurnId: latest.id
      },
      turns,
      diff: latest.diff
    });
    this.reviews.set(id, record);
    const withTimeline = withEvents(record, await this.readEvents(id));
    this.reviews.set(id, withTimeline);
    return withTimeline;
  }

  private async loadReviewFromTurnsOnly(id: string): Promise<ReviewRecord | null> {
    const turns = await this.loadPersistedTurns(id);
    if (turns.length === 0) {
      return null;
    }

    const latest = latestTurn({ turns });
    const record = normalizeRecord({
      meta: {
        id,
        cwd: latest.diff.cwd,
        base: latest.diff.base,
        branch: latest.diff.branch,
        status: latest.status,
        createdAt: turns[0]?.createdAt ?? latest.createdAt,
        artifactDir: globalReviewDir(id),
        activeTurnId: latest.id
      },
      turns,
      diff: latest.diff
    });
    this.reviews.set(id, record);
    const withTimeline = withEvents(record, await this.readEvents(id));
    this.reviews.set(id, withTimeline);
    await this.persistMeta(withTimeline);
    return withTimeline;
  }

  private async loadPersistedTurns(id: string): Promise<ReviewTurn[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(globalReviewTurnsDir(id), { withFileTypes: true });
    } catch (error) {
      if (isFileNotFound(error)) {
        return [];
      }
      throw new Error(`Could not read review turns for ${id}: ${formatError(error)}`, {
        cause: error
      });
    }

    const turns: ReviewTurn[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const turn = await this.loadPersistedTurn(id, entry.name);
      if (turn) {
        turns.push(turn);
      }
    }

    return turns.toSorted((a, b) => a.index - b.index);
  }

  private async loadPersistedTurn(id: string, turnId: string): Promise<ReviewTurn | null> {
    const metaPath = globalReviewTurnMetaFile(id, turnId);
    const diffPath = globalReviewTurnDiffFile(id, turnId);
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
      throw new Error(`Could not load review ${id} turn ${turnId}: ${formatError(error)}`, {
        cause: error
      });
    }

    const meta = parseJsonFile(metaRaw, isReviewTurnMeta, 'review turn metadata', metaPath);
    const diff = parseJsonFile(diffRaw, isDiffPayload, 'review turn diff', diffPath);
    const [feedback, resolution] = await Promise.all([
      readOptionalJsonFile(
        globalReviewTurnFeedbackFile(id, turnId),
        isFeedbackBundle,
        'review feedback'
      ),
      readOptionalJsonFile(
        globalReviewTurnResolvedFile(id, turnId),
        isResolutionBundle,
        'review resolution'
      )
    ]);

    return reconcileTurn(meta, diff, feedback, resolution);
  }

  private async loadLegacyTurn(
    id: string,
    storedMeta: StoredReviewMeta
  ): Promise<ReviewTurn | null> {
    const diffPath = globalReviewDiffFile(id);
    let diffRaw: string;
    try {
      diffRaw = await readFile(diffPath, 'utf8');
    } catch (error) {
      if (isFileNotFound(error)) {
        return null;
      }
      throw new Error(`Could not load legacy review ${id}: ${formatError(error)}`, {
        cause: error
      });
    }

    const diff = parseJsonFile(diffRaw, isDiffPayload, 'review diff', diffPath);
    const [feedback, resolution] = await Promise.all([
      readOptionalJsonFile(globalReviewFeedbackFile(id), isFeedbackBundle, 'review feedback'),
      readOptionalJsonFile(globalReviewResolvedFile(id), isResolutionBundle, 'review resolution')
    ]);
    const artifactDir = storedMeta.artifactDir ?? globalReviewDir(id);
    const legacySummary =
      storedMeta.turns?.find(
        (turn) => turn.artifactDir === artifactDir || turn.diffPath === diffPath
      ) ??
      storedMeta.turns?.find((turn) => turn.index === 1) ??
      storedMeta.turns?.[0];
    const meta: ReviewTurnMeta = {
      id: legacySummary?.id ?? storedMeta.activeTurnId ?? 'turn-1',
      index: legacySummary?.index ?? 1,
      status: legacySummary?.status ?? storedMeta.status,
      createdAt: legacySummary?.createdAt ?? storedMeta.createdAt,
      submittedAt: legacySummary?.submittedAt ?? storedMeta.submittedAt,
      resolvedAt: legacySummary?.resolvedAt ?? storedMeta.resolvedAt,
      artifactDir: legacySummary?.artifactDir ?? artifactDir,
      diffPath,
      ...(feedback
        ? { feedbackPath: globalReviewFeedbackFile(id), markdownPath: globalReviewMarkdownFile(id) }
        : {}),
      ...(resolution ? { resolvedPath: globalReviewResolvedFile(id) } : {})
    };
    return reconcileTurn(meta, diff, feedback, resolution);
  }

  private assertResolvable(
    turn: ReviewTurn,
    id: string
  ): asserts turn is ReviewTurn & {
    feedback: FeedbackBundle;
  } {
    if (!isResolvableReviewStatus(turn.status)) {
      throw new Error(`Review ${id} turn ${turn.index} is ${turn.status} and cannot be resolved`);
    }
    if (!turn.feedback) {
      throw new Error(`Review ${id} turn ${turn.index} has no submitted feedback`);
    }
  }

  private resolveTurnSelector(record: ReviewRecord, selector?: string): ReviewTurn {
    if (!selector) {
      return activeTurn(record);
    }
    const turn =
      record.turns.find((candidate) => candidate.id === selector) ??
      record.turns.find((candidate) => String(candidate.index) === selector);
    if (!turn) {
      throw new Error(`Turn ${selector} not found in review ${record.meta.id}`);
    }
    return turn;
  }

  private findTurnForComment(record: ReviewRecord, commentId: string): ReviewTurn | null {
    return (
      [...record.turns]
        .reverse()
        .find((candidate) =>
          candidate.feedback?.comments.some((comment) => comment.id === commentId)
        ) ?? null
    );
  }

  private async persistResolution(
    record: ReviewRecord,
    turn: ReviewTurn & { feedback: FeedbackBundle },
    resolution: ResolutionBundle,
    reason: ReviewUpdateReason
  ): Promise<ResolveResult> {
    const resolvedPath = globalReviewTurnResolvedFile(record.meta.id, turn.id);
    const nextTurn: ReviewTurn = {
      ...turn,
      resolvedPath,
      resolution
    };
    const nextRecord = normalizeRecord(replaceTurn(record, nextTurn));
    this.reviews.set(record.meta.id, nextRecord);
    await ensureDir(globalReviewTurnDir(record.meta.id, nextTurn.id));
    await Promise.all([
      writeJsonFile(resolvedPath, resolution),
      writeJsonFile(globalReviewTurnMetaFile(record.meta.id, nextTurn.id), turnMeta(nextTurn))
    ]);
    await this.persistMeta(nextRecord);
    const result: ResolveResult = {
      ok: true,
      reviewId: record.meta.id,
      turnId: nextTurn.id,
      turnIndex: nextTurn.index,
      status: nextTurn.status,
      resolutionStatus: resolution.status,
      comments: resolutionCounts(nextTurn.feedback, resolution.comments),
      path: resolvedPath,
      resolution
    };
    await this.appendReviewEvent(record.meta.id, 'agent', {
      type: 'review.updated',
      reviewId: record.meta.id,
      turnId: nextTurn.id,
      turnIndex: nextTurn.index,
      reason,
      status: result.status,
      resolutionStatus: result.resolutionStatus,
      counts: result.comments
    });
    return result;
  }

  private sortResolvedComments(
    comments: ResolvedComment[],
    turn: ReviewTurn & { feedback: FeedbackBundle }
  ): ResolvedComment[] {
    const feedbackIndex = new Map(
      turn.feedback.comments.map((comment, index) => [comment.id, index] as const)
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

function createTurn(
  reviewId: string,
  index: number,
  diff: DiffPayload,
  createdAt: string
): ReviewTurn {
  const id = ulid();
  return {
    id,
    index,
    status: 'pending',
    createdAt,
    artifactDir: globalReviewTurnDir(reviewId, id),
    diffPath: globalReviewTurnDiffFile(reviewId, id),
    diff
  };
}

function normalizeRecord(record: Pick<ReviewRecord, 'meta' | 'turns' | 'diff'>): ReviewRecord {
  const turns = record.turns.toSorted((a, b) => a.index - b.index);
  const active =
    turns.find((turn) => turn.id === record.meta.activeTurnId) ?? turns[turns.length - 1];
  const meta: ReviewMeta = {
    ...record.meta,
    base: active.diff.base,
    branch: active.diff.branch,
    status: active.status,
    submittedAt: active.submittedAt,
    resolvedAt: active.resolvedAt,
    artifactDir: record.meta.artifactDir ?? globalReviewDir(record.meta.id),
    activeTurnId: active.id,
    turns: turns.map(turnSummary),
    feedbackPath: active.feedbackPath,
    markdownPath: active.markdownPath
  };
  return {
    meta,
    turns,
    diff: active.diff,
    ...(active.feedback ? { feedback: active.feedback } : {}),
    ...(active.resolution ? { resolution: active.resolution } : {})
  };
}

function replaceTurn(record: ReviewRecord, nextTurn: ReviewTurn): ReviewRecord {
  return {
    ...record,
    turns: record.turns.map((turn) => (turn.id === nextTurn.id ? nextTurn : turn))
  };
}

function activeTurn(record: ReviewRecord): ReviewTurn {
  return (
    record.turns.find((turn) => turn.id === record.meta.activeTurnId) ??
    record.turns[record.turns.length - 1]
  );
}

function latestTurn(record: Pick<ReviewRecord, 'turns'>): ReviewTurn {
  return record.turns.toSorted((a, b) => a.index - b.index)[record.turns.length - 1];
}

function turnMeta(turn: ReviewTurn): ReviewTurnMeta {
  return {
    id: turn.id,
    index: turn.index,
    status: turn.status,
    createdAt: turn.createdAt,
    submittedAt: turn.submittedAt,
    resolvedAt: turn.resolvedAt,
    artifactDir: turn.artifactDir,
    diffPath: turn.diffPath,
    feedbackPath: turn.feedbackPath,
    markdownPath: turn.markdownPath,
    resolvedPath: turn.resolvedPath
  };
}

function turnSummary(turn: ReviewTurn): ReviewTurnSummary {
  return {
    ...turnMeta(turn),
    capturedAt: turn.diff.capturedAt,
    stats: turn.diff.stats,
    comments: resolutionCounts(turn.feedback, turn.resolution?.comments ?? [])
  };
}

function withEvents(record: ReviewRecord, events: ReviewEvent[]): ReviewRecord {
  return { ...record, events: events.toSorted(compareReviewEvents) };
}

function nextEventSeq(events: ReviewEvent[]): number {
  return Math.max(0, ...events.map((event) => event.seq ?? 0)) + 1;
}

function synthesizeReviewEvents(record: ReviewRecord): ReviewEvent[] {
  let seq = 1;
  const next = (
    actor: NonNullable<ReviewEvent['actor']>,
    input: ReviewEventInput,
    createdAt: string
  ): ReviewEvent =>
    ({
      ...input,
      id: ulid(),
      seq: seq++,
      createdAt,
      actor
    }) as ReviewEvent;
  const events: ReviewEvent[] = [
    next('system', { type: 'review.opened', reviewId: record.meta.id }, record.meta.createdAt)
  ];
  const turns = record.turns.toSorted((a, b) => a.index - b.index);
  for (const turn of turns) {
    if (turn.index > 1) {
      events.push(
        next(
          'system',
          {
            type: 'review.turn.created',
            reviewId: record.meta.id,
            turnId: turn.id,
            turnIndex: turn.index,
            reused: false
          },
          turn.createdAt
        )
      );
    }
    if (turn.feedback) {
      events.push(
        next(
          'human',
          {
            type: 'review.submitted',
            reviewId: record.meta.id,
            turnId: turn.id,
            turnIndex: turn.index,
            counts: {
              files: countCommentFiles(turn.feedback.comments),
              comments: turn.feedback.comments.length
            }
          },
          turn.submittedAt ?? turn.feedback.timestamp
        )
      );
    }
    if (turn.feedback && turn.resolution) {
      const counts = resolutionCounts(turn.feedback, turn.resolution.comments);
      events.push(
        next(
          'agent',
          {
            type: 'review.updated',
            reviewId: record.meta.id,
            turnId: turn.id,
            turnIndex: turn.index,
            reason: turn.resolution.status === 'resolved' ? 'review-resolved' : 'comment-resolved',
            status: turn.status,
            resolutionStatus: turn.resolution.status,
            counts
          },
          turn.resolution.resolvedAt ??
            turn.resolution.comments.at(-1)?.resolvedAt ??
            turn.resolvedAt ??
            turn.submittedAt ??
            turn.createdAt
        )
      );
    }
  }
  return events.toSorted(compareReviewEvents);
}

function compareReviewEvents(left: ReviewEvent, right: ReviewEvent): number {
  const seqDelta = (left.seq ?? 0) - (right.seq ?? 0);
  if (seqDelta !== 0) {
    return seqDelta;
  }
  return (left.createdAt ?? '').localeCompare(right.createdAt ?? '');
}

function reconcileTurn(
  meta: ReviewTurnMeta,
  diff: DiffPayload,
  feedback?: FeedbackBundle,
  resolution?: ResolutionBundle
): ReviewTurn {
  const status =
    resolution?.status === 'resolved' ? 'resolved' : feedback ? 'submitted' : 'pending';
  return {
    ...meta,
    status,
    submittedAt: feedback?.timestamp ?? meta.submittedAt,
    resolvedAt: status === 'resolved' ? (resolution?.resolvedAt ?? meta.resolvedAt) : undefined,
    feedbackPath: feedback
      ? (meta.feedbackPath ?? path.join(meta.artifactDir, 'feedback.json'))
      : undefined,
    markdownPath: feedback
      ? (meta.markdownPath ?? path.join(meta.artifactDir, 'feedback.md'))
      : undefined,
    resolvedPath: resolution
      ? (meta.resolvedPath ?? path.join(meta.artifactDir, 'resolved.json'))
      : undefined,
    diff,
    ...(feedback ? { feedback } : {}),
    ...(resolution ? { resolution } : {})
  };
}

function mergeRecoveredTurns(
  legacyTurn: ReviewTurn | null,
  persistedTurns: ReviewTurn[]
): ReviewTurn[] {
  const turns =
    legacyTurn &&
    !persistedTurns.some((turn) => turn.id === legacyTurn.id || turn.index === legacyTurn.index)
      ? [legacyTurn, ...persistedTurns]
      : persistedTurns;
  return turns.toSorted((a, b) => a.index - b.index);
}

function diffFingerprint(diff: DiffPayload): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        base: diff.base,
        branch: diff.branch,
        cwd: diff.cwd,
        scope: diff.scope,
        rawDiff: diff.rawDiff
      })
    )
    .digest('hex');
}

function sameComments(left: Comment[], right: Comment[]): boolean {
  return (
    JSON.stringify(left.toSorted(compareCommentsByLocation)) ===
    JSON.stringify(right.toSorted(compareCommentsByLocation))
  );
}

function requiredPath(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Submitted review is missing ${label}`);
  }
  return value;
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
