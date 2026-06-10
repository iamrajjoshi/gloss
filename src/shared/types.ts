export const SIDES = ['L', 'R'] as const;

export type Side = (typeof SIDES)[number];

export const REVIEW_STATUSES = ['pending', 'submitted', 'cancelled', 'resolved'] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ClearReviewEntry {
  reviewId: string;
  status: ReviewStatus;
  artifactDir: string;
  lastActivityAt: string;
}

export interface ClearReviewSkipped {
  reviewId: string;
  artifactDir: string;
  reason: string;
}

export interface ClearReviewsRequest {
  olderThanDays?: number;
  dryRun?: boolean;
}

export interface ClearReviewsResult {
  reviewsDir: string;
  cutoff: string;
  olderThanDays: number;
  dryRun: boolean;
  candidates: ClearReviewEntry[];
  deleted: ClearReviewEntry[];
  skipped: ClearReviewSkipped[];
  counts: {
    candidates: number;
    deleted: number;
    skipped: number;
  };
}

export interface Comment {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  side: Side;
  body: string;
  originalSnippet: string;
  createdAt: string;
}

export const DIFF_LINE_TYPES = ['context', 'add', 'delete'] as const;

export type DiffLineType = (typeof DIFF_LINE_TYPES)[number];

export interface DiffLine {
  type: DiffLineType;
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isDeleted: boolean;
  isNew: boolean;
  isRenamed: boolean;
  language: string | null;
  hunks: DiffHunk[];
}

export const DIFF_SCOPE_MODES = ['working', 'branch', 'explicit'] as const;

export type DiffScopeMode = (typeof DIFF_SCOPE_MODES)[number];

export const DIFF_FALLBACK_REASONS = ['working-tree-clean', 'missing-branch-base'] as const;

export type DiffFallbackReason = (typeof DIFF_FALLBACK_REASONS)[number] | null;

export interface BaseRef {
  ref: string;
  sha: string;
}

export interface DiffRef {
  ref: string;
  sha: string | null;
}

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

export interface DiffCommit {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committedAt: string;
}

export interface CommitDiff {
  commit: DiffCommit;
  stats: DiffStats;
  rawDiff: string;
  files: DiffFile[];
}

export interface CommitRangeDiffRequest {
  fromSha: string;
  toSha: string;
  turnId?: string;
}

export interface CommitRangeDiffResponse {
  fromSha: string;
  toSha: string;
  stats: DiffStats;
  rawDiff: string;
  files: DiffFile[];
}

export const REVIEW_SCOPE_MODES = ['all', 'single', 'range'] as const;

export type ReviewScope =
  | { mode: 'all' }
  | { mode: 'single'; sha: string }
  | { mode: 'range'; fromSha: string; toSha: string };

interface DiffScope {
  mode: DiffScopeMode;
  requestedBase: string | null;
  base: BaseRef;
  comparison: DiffRef;
  fallbackReason: DiffFallbackReason;
}

export interface DiffPayload {
  base: BaseRef;
  branch: string | null;
  cwd: string;
  scope: DiffScope;
  stats: DiffStats;
  rawDiff: string;
  files: DiffFile[];
  commitDiffs?: CommitDiff[];
  capturedAt: string;
}

export interface ReviewMeta {
  id: string;
  cwd: string;
  base: DiffPayload['base'];
  branch: string | null;
  status: ReviewStatus;
  createdAt: string;
  submittedAt?: string;
  resolvedAt?: string;
  artifactDir: string;
  activeTurnId?: string;
  turns?: ReviewTurnSummary[];
  feedbackPath?: string;
  markdownPath?: string;
}

export interface FeedbackBundle {
  version: 1;
  reviewId: string;
  turnId?: string;
  turnIndex?: number;
  timestamp: string;
  base: DiffPayload['base'];
  branch: string | null;
  reviewScope?: ReviewScope;
  comments: Comment[];
}

export const RESOLUTION_STATUSES = ['partial', 'resolved'] as const;

type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

export interface ResolvedComment {
  commentId: string;
  status: 'resolved';
  summary?: string;
  resolvedAt: string;
}

export interface ResolutionBundle {
  reviewId: string;
  turnId?: string;
  turnIndex?: number;
  status: ResolutionStatus;
  summary: string | null;
  resolvedAt: string | null;
  comments: ResolvedComment[];
}

export interface ResolutionCounts {
  total: number;
  resolved: number;
  open: number;
}

export interface ResolveResult {
  ok: true;
  reviewId: string;
  turnId?: string;
  turnIndex?: number;
  status: ReviewStatus;
  resolutionStatus: ResolutionStatus;
  comments: ResolutionCounts;
  path: string;
  resolution: ResolutionBundle;
}

export const REVIEW_UPDATE_REASONS = [
  'review-resolved',
  'comment-resolved',
  'comment-reopened',
  'turn-created'
] as const;

export type ReviewUpdateReason = (typeof REVIEW_UPDATE_REASONS)[number];

export type ReviewEvent =
  | { type: 'review.opened'; reviewId: string }
  | {
      type: 'review.turn.created';
      reviewId: string;
      turnId: string;
      turnIndex: number;
      reused: boolean;
    }
  | {
      type: 'review.submitted';
      reviewId: string;
      turnId?: string;
      turnIndex?: number;
      counts: { files: number; comments: number };
    }
  | {
      type: 'review.updated';
      reviewId: string;
      turnId?: string;
      turnIndex?: number;
      reason: ReviewUpdateReason;
      status: ReviewStatus;
      resolutionStatus: ResolutionStatus;
      counts: ResolutionCounts;
    }
  | { type: 'review.cancelled'; reviewId: string };

export interface ReviewTurnMeta {
  id: string;
  index: number;
  status: ReviewStatus;
  createdAt: string;
  submittedAt?: string;
  resolvedAt?: string;
  artifactDir: string;
  diffPath: string;
  feedbackPath?: string;
  markdownPath?: string;
  resolvedPath?: string;
}

export interface ReviewTurnSummary extends ReviewTurnMeta {
  capturedAt: string;
  stats: DiffStats;
  comments: ResolutionCounts;
}

export interface ReviewTurn extends ReviewTurnMeta {
  diff: DiffPayload;
  feedback?: FeedbackBundle;
  resolution?: ResolutionBundle;
}

export interface ReviewRecord {
  meta: ReviewMeta;
  turns: ReviewTurn[];
  diff: DiffPayload;
  feedback?: FeedbackBundle;
  resolution?: ResolutionBundle;
}

export interface ServerInfo {
  pid: number;
  port: number;
  version: string;
  startedAt: string;
  stateDir: string;
  cwd?: string;
  daemonPath?: string;
}

export interface OpenResult {
  reviewId: string;
  turnId?: string;
  turnIndex?: number;
  url: string;
  files: number;
  comments?: number;
  feedbackPath?: string;
  markdownPath?: string;
  artifactDir?: string;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  activeReviews: number;
  connections?: number;
  stateDir?: string;
  cwd?: string;
  daemonPath?: string;
}

interface ReviewRegistrationResponse {
  meta: ReviewMeta;
  url: string;
  turn?: ReviewTurnSummary;
}

export interface CreateReviewResponse extends ReviewRegistrationResponse {}

export interface CreateReviewTurnResponse extends ReviewRegistrationResponse {
  turn: ReviewTurnSummary;
  reused: boolean;
}

export interface ListReviewsResponse {
  reviews: ReviewMeta[];
}

export interface SubmitReviewRequest {
  comments: Comment[];
  reviewScope?: ReviewScope;
}

export interface ResolutionRequest {
  summary?: string;
  turn?: string;
}

export interface OpenFileRequest {
  filePath: string;
  turnId?: string;
}

export interface OpenFileResponse {
  ok: true;
  path: string;
}
