export type Side = 'L' | 'R';

export type ReviewStatus = 'pending' | 'submitted' | 'cancelled' | 'resolved';

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

export type DiffLineType = 'context' | 'add' | 'delete';

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

export type DiffScopeMode = 'working' | 'branch' | 'explicit';

export type DiffFallbackReason = 'working-tree-clean' | 'missing-branch-base' | null;

interface DiffRef {
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
}

export interface CommitRangeDiffResponse {
  fromSha: string;
  toSha: string;
  stats: DiffStats;
  rawDiff: string;
  files: DiffFile[];
}

interface DiffScope {
  mode: DiffScopeMode;
  requestedBase: string | null;
  base: { ref: string; sha: string };
  comparison: DiffRef;
  fallbackReason: DiffFallbackReason;
}

export interface DiffPayload {
  base: { ref: string; sha: string };
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
  feedbackPath?: string;
  markdownPath?: string;
}

export interface FeedbackBundle {
  version: 1;
  reviewId: string;
  timestamp: string;
  base: DiffPayload['base'];
  branch: string | null;
  comments: Comment[];
}

type ResolutionStatus = 'partial' | 'resolved';

export interface ResolvedComment {
  commentId: string;
  status: 'resolved';
  summary?: string;
  resolvedAt: string;
}

export interface ResolutionBundle {
  reviewId: string;
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
  status: ReviewStatus;
  resolutionStatus: ResolutionStatus;
  comments: ResolutionCounts;
  path: string;
  resolution: ResolutionBundle;
}

export type ReviewUpdateReason = 'review-resolved' | 'comment-resolved' | 'comment-reopened';

export type ReviewEvent =
  | { type: 'review.opened'; reviewId: string }
  | {
      type: 'review.submitted';
      reviewId: string;
      counts: { files: number; comments: number };
    }
  | {
      type: 'review.updated';
      reviewId: string;
      reason: ReviewUpdateReason;
      status: ReviewStatus;
      resolutionStatus: ResolutionStatus;
      counts: ResolutionCounts;
    }
  | { type: 'review.cancelled'; reviewId: string };

export interface ReviewRecord {
  meta: ReviewMeta;
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
}

export interface OpenResult {
  reviewId: string;
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
}

export interface CreateReviewResponse {
  meta: ReviewMeta;
  url: string;
}

export interface ListReviewsResponse {
  reviews: ReviewMeta[];
}

export interface SubmitReviewRequest {
  comments: Comment[];
}

export interface ResolutionRequest {
  summary?: string;
}

export interface OpenFileRequest {
  filePath: string;
}

export interface OpenFileResponse {
  ok: true;
  path: string;
}
