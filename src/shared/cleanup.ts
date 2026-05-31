import type { Dirent } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { formatError, isFileNotFound } from './errors';
import {
  globalReviewDir,
  globalReviewMetaFile,
  globalReviewsDir,
  globalReviewTurnMetaFile,
  globalReviewTurnsDir
} from './paths';
import type {
  ClearReviewEntry,
  ClearReviewsRequest,
  ClearReviewsResult,
  ReviewStatus,
  ReviewTurnMeta
} from './types';
import {
  isReviewTurnMeta,
  isStoredReviewMeta,
  parseJson,
  type StoredReviewMeta
} from './validation';

export const DEFAULT_REVIEW_RETENTION_DAYS = 30;

const clearableStatuses = new Set<ReviewStatus>(['submitted', 'resolved', 'cancelled']);
const millisecondsPerDay = 24 * 60 * 60 * 1000;

export interface ClearReviewArtifactsOptions extends ClearReviewsRequest {
  now?: Date;
}

export async function clearReviewArtifacts(
  options: ClearReviewArtifactsOptions = {}
): Promise<ClearReviewsResult> {
  const olderThanDays = normalizeRetentionDays(options.olderThanDays);
  const dryRun = options.dryRun === true;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanDays * millisecondsPerDay);
  const reviewsDir = globalReviewsDir();
  const candidates: ClearReviewEntry[] = [];
  const deleted: ClearReviewEntry[] = [];
  const skipped: ClearReviewsResult['skipped'] = [];

  let entries: Dirent[];
  try {
    entries = await readdir(reviewsDir, { withFileTypes: true });
  } catch (error) {
    if (isFileNotFound(error)) {
      return cleanupResult({
        reviewsDir,
        cutoff,
        olderThanDays,
        dryRun,
        candidates,
        deleted,
        skipped
      });
    }
    throw new Error(`Could not read reviews directory at ${reviewsDir}: ${formatError(error)}`, {
      cause: error
    });
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const reviewId = entry.name;
    const artifactDir = globalReviewDir(reviewId);
    const candidate = await cleanupCandidate(reviewId, artifactDir, cutoff, skipped);
    if (!candidate) {
      continue;
    }
    candidates.push(candidate);
    if (!dryRun) {
      await rm(artifactDir, { recursive: true, force: true });
      deleted.push(candidate);
    }
  }

  return cleanupResult({ reviewsDir, cutoff, olderThanDays, dryRun, candidates, deleted, skipped });
}

function normalizeRetentionDays(value: number | undefined): number {
  const days = value ?? DEFAULT_REVIEW_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 0) {
    throw new Error('olderThanDays must be a non-negative integer');
  }
  return days;
}

async function cleanupCandidate(
  reviewId: string,
  artifactDir: string,
  cutoff: Date,
  skipped: ClearReviewsResult['skipped']
): Promise<ClearReviewEntry | null> {
  let raw: string;
  try {
    raw = await readFile(globalReviewMetaFile(reviewId), 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) {
      skipped.push({ reviewId, artifactDir, reason: 'missing metadata' });
      return null;
    }
    skipped.push({ reviewId, artifactDir, reason: `unreadable metadata: ${formatError(error)}` });
    return null;
  }

  let meta: StoredReviewMeta;
  try {
    meta = parseJson(raw, isStoredReviewMeta, 'review metadata');
  } catch (error) {
    skipped.push({ reviewId, artifactDir, reason: `invalid metadata: ${formatError(error)}` });
    return null;
  }

  if (meta.id !== reviewId) {
    skipped.push({ reviewId, artifactDir, reason: `metadata id mismatch: ${meta.id}` });
    return null;
  }
  if (!clearableStatuses.has(meta.status)) {
    return null;
  }

  const turnState = await persistedTurnCleanupState(reviewId, artifactDir, skipped);
  if (turnState === 'preserve') {
    return null;
  }

  const lastActivityAt = latestTimestamp([
    ...metadataTimestamps(meta),
    ...(turnState === 'none' ? [] : turnState.timestamps)
  ]);
  if (!lastActivityAt) {
    skipped.push({ reviewId, artifactDir, reason: 'missing valid activity timestamp' });
    return null;
  }
  if (Date.parse(lastActivityAt) >= cutoff.getTime()) {
    return null;
  }

  return {
    reviewId,
    status: meta.status,
    artifactDir,
    lastActivityAt
  };
}

async function persistedTurnCleanupState(
  reviewId: string,
  artifactDir: string,
  skipped: ClearReviewsResult['skipped']
): Promise<'none' | 'preserve' | { timestamps: Array<string | undefined> }> {
  let entries: Dirent[];
  try {
    entries = await readdir(globalReviewTurnsDir(reviewId), { withFileTypes: true });
  } catch (error) {
    if (isFileNotFound(error)) {
      return 'none';
    }
    skipped.push({
      reviewId,
      artifactDir,
      reason: `unreadable turns directory: ${formatError(error)}`
    });
    return 'preserve';
  }

  const turnDirs = entries.filter((entry) => entry.isDirectory());
  if (turnDirs.length === 0) {
    return 'none';
  }

  const timestamps: Array<string | undefined> = [];
  for (const entry of turnDirs) {
    const turn = await readPersistedTurnMeta(reviewId, entry.name, artifactDir, skipped);
    if (!turn) {
      return 'preserve';
    }
    if (turn.status === 'pending' || !clearableStatuses.has(turn.status)) {
      return 'preserve';
    }
    timestamps.push(turn.createdAt, turn.submittedAt, turn.resolvedAt);
  }

  return { timestamps };
}

async function readPersistedTurnMeta(
  reviewId: string,
  turnDirName: string,
  artifactDir: string,
  skipped: ClearReviewsResult['skipped']
): Promise<ReviewTurnMeta | null> {
  let raw: string;
  try {
    raw = await readFile(globalReviewTurnMetaFile(reviewId, turnDirName), 'utf8');
  } catch (error) {
    skipped.push({
      reviewId,
      artifactDir,
      reason: `${isFileNotFound(error) ? 'missing' : 'unreadable'} turn metadata for ${turnDirName}${
        isFileNotFound(error) ? '' : `: ${formatError(error)}`
      }`
    });
    return null;
  }

  try {
    const turn = parseJson(raw, isReviewTurnMeta, 'review turn metadata');
    if (turn.id !== turnDirName) {
      skipped.push({
        reviewId,
        artifactDir,
        reason: `turn metadata id mismatch for ${turnDirName}: ${turn.id}`
      });
      return null;
    }
    return turn;
  } catch (error) {
    skipped.push({
      reviewId,
      artifactDir,
      reason: `invalid turn metadata for ${turnDirName}: ${formatError(error)}`
    });
    return null;
  }
}

function metadataTimestamps(meta: StoredReviewMeta): Array<string | undefined> {
  return [
    meta.createdAt,
    meta.submittedAt,
    meta.resolvedAt,
    ...(meta.turns ?? []).flatMap((turn) => [
      turn.createdAt,
      turn.capturedAt,
      turn.submittedAt,
      turn.resolvedAt
    ])
  ];
}

function latestTimestamp(timestamps: Array<string | undefined | null>): string | null {
  const latest = Math.max(
    ...timestamps
      .map((timestamp) => (timestamp ? Date.parse(timestamp) : Number.NaN))
      .filter((timestamp) => Number.isFinite(timestamp))
  );
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

function cleanupResult({
  reviewsDir,
  cutoff,
  olderThanDays,
  dryRun,
  candidates,
  deleted,
  skipped
}: Omit<ClearReviewsResult, 'cutoff' | 'counts'> & { cutoff: Date }): ClearReviewsResult {
  return {
    reviewsDir,
    cutoff: cutoff.toISOString(),
    olderThanDays,
    dryRun,
    candidates,
    deleted,
    skipped,
    counts: {
      candidates: candidates.length,
      deleted: deleted.length,
      skipped: skipped.length
    }
  };
}
