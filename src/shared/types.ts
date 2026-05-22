export type Side = 'L' | 'R';

export type ReviewStatus = 'pending' | 'completed' | 'cancelled';

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

export interface DiffRef {
  ref: string;
  sha: string | null;
}

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

export interface DiffScope {
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
  capturedAt: string;
}

export interface ReviewMeta {
  id: string;
  cwd: string;
  base: DiffPayload['base'];
  branch: string | null;
  status: ReviewStatus;
  createdAt: string;
  completedAt?: string;
}

export interface FeedbackBundle {
  version: 1;
  reviewId: string;
  timestamp: string;
  base: DiffPayload['base'];
  branch: string | null;
  comments: Comment[];
}

export type ReviewEvent =
  | { type: 'review.opened'; reviewId: string }
  | {
      type: 'review.completed';
      reviewId: string;
      counts: { files: number; comments: number };
    }
  | { type: 'review.cancelled'; reviewId: string };

export interface ReviewRecord {
  meta: ReviewMeta;
  diff: DiffPayload;
  feedback?: FeedbackBundle;
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
}
