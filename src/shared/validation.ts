import type { JsonValue } from './json';
import type {
  AgentClaimRequest,
  AgentClaimResponse,
  AgentNoteRequest,
  AgentNoteResponse,
  AgentStatus,
  ClearReviewEntry,
  ClearReviewsRequest,
  ClearReviewsResult,
  Comment,
  CommitDiff,
  CommitRangeDiffRequest,
  CommitRangeDiffResponse,
  CreateReviewResponse,
  CreateReviewTurnResponse,
  DiffCommit,
  DiffContextRequest,
  DiffContextResponse,
  DiffContextSource,
  DiffFile,
  DiffHunk,
  DiffLine,
  DiffPayload,
  DiffStats,
  FeedbackBundle,
  FileContentRequest,
  FileContentResponse,
  HealthResponse,
  ListReviewsResponse,
  OpenFileRequest,
  OpenFileResponse,
  OpenFileScope,
  OpenFileTarget,
  OpenFileTargetInfo,
  OpenFileTargetsResponse,
  OpenResult,
  ResolutionBundle,
  ResolutionRequest,
  ResolvedComment,
  ResolveResult,
  ReviewEvent,
  ReviewEventActor,
  ReviewMeta,
  ReviewRecord,
  ReviewScope,
  ReviewTurn,
  ReviewTurnMeta,
  ReviewTurnSummary,
  ServerInfo,
  SourcePeekMatchReason,
  SourcePeekRangeRequest,
  SourcePeekRangeResponse,
  SourcePeekRequest,
  SourcePeekResponse,
  SubmitReviewRequest
} from './types';
import {
  AGENT_STATUSES,
  DIFF_FALLBACK_REASONS,
  DIFF_LINE_TYPES,
  DIFF_SCOPE_MODES,
  OPEN_FILE_SCOPES,
  OPEN_FILE_TARGETS,
  RESOLUTION_STATUSES,
  REVIEW_EVENT_ACTORS,
  REVIEW_SCOPE_MODES,
  REVIEW_STATUSES,
  REVIEW_UPDATE_REASONS,
  SIDES,
  SOURCE_PEEK_MATCH_REASONS,
  SOURCE_PEEK_RANGE_MAX_LINES
} from './types';

export type JsonGuard<T> = (value: unknown) => value is T;

export type StoredReviewMeta = Omit<ReviewMeta, 'artifactDir'> &
  Partial<
    Pick<ReviewMeta, 'artifactDir' | 'activeTurnId' | 'turns' | 'feedbackPath' | 'markdownPath'>
  >;

type ReviewRegistrationResponseShape = {
  meta: ReviewMeta;
  url: string;
  turn?: ReviewTurnSummary;
};

export function parseJson<T>(raw: string, guard: JsonGuard<T>, label: string): T {
  const parsed: JsonValue = JSON.parse(raw);
  return parseJsonValue(parsed, guard, label);
}

export function parseJsonValue<T>(value: JsonValue, guard: JsonGuard<T>, label: string): T {
  if (!guard(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function isServerInfo(value: unknown): value is ServerInfo {
  return (
    isRecord(value) &&
    isNumber(value.pid) &&
    isNumber(value.port) &&
    isString(value.version) &&
    isOptionalNumber(value.protocolVersion) &&
    isString(value.startedAt) &&
    isString(value.stateDir) &&
    isOptionalString(value.cwd) &&
    isOptionalString(value.daemonPath)
  );
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    isRecord(value) &&
    isBoolean(value.ok) &&
    isString(value.version) &&
    isNumber(value.protocolVersion) &&
    isNumber(value.activeReviews) &&
    isOptionalNumber(value.connections) &&
    isOptionalString(value.stateDir) &&
    isOptionalString(value.cwd) &&
    isOptionalString(value.daemonPath)
  );
}

export function isClearReviewsRequest(value: unknown): value is ClearReviewsRequest {
  return (
    isRecord(value) &&
    isOptionalNonNegativeInteger(value.olderThanDays) &&
    isOptionalBoolean(value.dryRun)
  );
}

export function isClearReviewsResult(value: unknown): value is ClearReviewsResult {
  return (
    isRecord(value) &&
    isString(value.reviewsDir) &&
    isString(value.cutoff) &&
    isNumber(value.olderThanDays) &&
    isBoolean(value.dryRun) &&
    isArrayOf(value.candidates, isClearReviewEntry) &&
    isArrayOf(value.deleted, isClearReviewEntry) &&
    isArrayOf(value.skipped, isClearReviewSkipped) &&
    isRecord(value.counts) &&
    isNumber(value.counts.candidates) &&
    isNumber(value.counts.deleted) &&
    isNumber(value.counts.skipped)
  );
}

export function isCreateReviewResponse(value: unknown): value is CreateReviewResponse {
  return (
    isRecord(value) &&
    hasReviewRegistrationFields(value) &&
    isOptional(value.turn, isReviewTurnSummary)
  );
}

export function isCreateReviewTurnResponse(value: unknown): value is CreateReviewTurnResponse {
  return (
    isRecord(value) &&
    hasReviewRegistrationFields(value) &&
    isReviewTurnSummary(value.turn) &&
    isBoolean(value.reused)
  );
}

export function isListReviewsResponse(value: unknown): value is ListReviewsResponse {
  return isRecord(value) && isArrayOf(value.reviews, isReviewMeta);
}

export function isOpenResult(value: unknown): value is OpenResult {
  return (
    isRecord(value) &&
    isString(value.reviewId) &&
    isOptionalString(value.turnId) &&
    isOptionalNumber(value.turnIndex) &&
    isString(value.url) &&
    isNumber(value.files) &&
    isOptionalNumber(value.comments) &&
    isOptionalString(value.feedbackPath) &&
    isOptionalString(value.markdownPath) &&
    isOptionalString(value.artifactDir)
  );
}

export function isOpenFileRequest(value: unknown): value is OpenFileRequest {
  return (
    isRecord(value) &&
    isString(value.filePath) &&
    isOptionalString(value.turnId) &&
    isOptional(value.scope, isOpenFileScope) &&
    isOptional(value.target, isOpenFileTarget)
  );
}

export function isOpenFileResponse(value: unknown): value is OpenFileResponse {
  return isRecord(value) && value.ok === true && isString(value.path);
}

export function isOpenFileTargetsResponse(value: unknown): value is OpenFileTargetsResponse {
  return isRecord(value) && isArrayOf(value.targets, isOpenFileTargetInfo);
}

export function isFileContentRequest(value: unknown): value is FileContentRequest {
  return (
    isRecord(value) &&
    isString(value.filePath) &&
    isOptionalString(value.turnId) &&
    isOptional(value.scope, isOpenFileScope)
  );
}

export function isFileContentResponse(value: unknown): value is FileContentResponse {
  return isRecord(value) && isString(value.filePath) && isString(value.content);
}

export function isCommitRangeDiffRequest(value: unknown): value is CommitRangeDiffRequest {
  return (
    isRecord(value) &&
    isString(value.fromSha) &&
    isString(value.toSha) &&
    isOptionalString(value.turnId)
  );
}

export function isCommitRangeDiffResponse(value: unknown): value is CommitRangeDiffResponse {
  return (
    isRecord(value) &&
    isString(value.fromSha) &&
    isString(value.toSha) &&
    isDiffStats(value.stats) &&
    isString(value.rawDiff) &&
    isArrayOf(value.files, isDiffFile)
  );
}

export function isDiffContextRequest(value: unknown): value is DiffContextRequest {
  return (
    isRecord(value) &&
    isString(value.filePath) &&
    isNullableString(value.oldPath) &&
    isOptionalString(value.turnId) &&
    isDiffContextSource(value.source) &&
    isPositiveInteger(value.oldStart) &&
    isPositiveInteger(value.newStart) &&
    isPositiveInteger(value.lineCount)
  );
}

export function isDiffContextResponse(value: unknown): value is DiffContextResponse {
  return (
    isRecord(value) &&
    isString(value.filePath) &&
    isPositiveInteger(value.oldStart) &&
    isPositiveInteger(value.newStart) &&
    isArrayOf(value.lines, isDiffLine)
  );
}

export function isSourcePeekRequest(value: unknown): value is SourcePeekRequest {
  return (
    isRecord(value) &&
    isString(value.filePath) &&
    isNullableString(value.oldPath) &&
    isOptionalString(value.turnId) &&
    isDiffContextSource(value.source) &&
    isOneOf(value.side, SIDES) &&
    isPositiveInteger(value.line) &&
    isNonNegativeInteger(value.column) &&
    isIdentifier(value.symbol)
  );
}

export function isSourcePeekResponse(value: unknown): value is SourcePeekResponse {
  return (
    isRecord(value) &&
    isString(value.symbol) &&
    isString(value.targetSymbol) &&
    isString(value.filePath) &&
    isPositiveInteger(value.startLine) &&
    isPositiveInteger(value.line) &&
    isNonNegativeInteger(value.column) &&
    isNullableString(value.language) &&
    isString(value.content) &&
    isBoolean(value.truncated) &&
    isPositiveInteger(value.totalLines) &&
    isBoolean(value.hasMoreAbove) &&
    isBoolean(value.hasMoreBelow) &&
    isSourcePeekMatchReason(value.matchReason)
  );
}

export function isSourcePeekRangeRequest(value: unknown): value is SourcePeekRangeRequest {
  return (
    isRecord(value) &&
    isString(value.filePath) &&
    isOptionalString(value.turnId) &&
    isDiffContextSource(value.source) &&
    isOneOf(value.side, SIDES) &&
    isPositiveInteger(value.startLine) &&
    isPositiveInteger(value.lineCount) &&
    value.lineCount <= SOURCE_PEEK_RANGE_MAX_LINES
  );
}

export function isSourcePeekRangeResponse(value: unknown): value is SourcePeekRangeResponse {
  return (
    isRecord(value) &&
    isString(value.filePath) &&
    isPositiveInteger(value.startLine) &&
    isPositiveInteger(value.totalLines) &&
    isString(value.content) &&
    isBoolean(value.truncated) &&
    isBoolean(value.hasMoreAbove) &&
    isBoolean(value.hasMoreBelow)
  );
}

export function isResolveResult(value: unknown): value is ResolveResult {
  return (
    isRecord(value) &&
    value.ok === true &&
    isString(value.reviewId) &&
    isOptionalString(value.turnId) &&
    isOptionalNumber(value.turnIndex) &&
    isReviewStatus(value.status) &&
    isResolutionStatus(value.resolutionStatus) &&
    isResolutionCounts(value.comments) &&
    isString(value.path) &&
    isResolutionBundle(value.resolution)
  );
}

export function isAgentClaimRequest(value: unknown): value is AgentClaimRequest {
  return isRecord(value) && isOptionalString(value.message) && isOptionalString(value.turn);
}

export function isAgentClaimResponse(value: unknown): value is AgentClaimResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    isString(value.reviewId) &&
    isString(value.turnId) &&
    isNumber(value.turnIndex) &&
    value.status === 'claimed' &&
    isString(value.feedbackPath) &&
    isString(value.markdownPath) &&
    isString(value.artifactDir) &&
    isFeedbackBundle(value.feedback) &&
    isOptional(value.resolution, isResolutionBundle) &&
    isReviewEvent(value.event)
  );
}

export function isAgentNoteRequest(value: unknown): value is AgentNoteRequest {
  return (
    isRecord(value) &&
    isString(value.message) &&
    isOptional(value.status, isAgentStatus) &&
    isOptionalString(value.turn)
  );
}

export function isAgentNoteResponse(value: unknown): value is AgentNoteResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    isString(value.reviewId) &&
    isOptionalString(value.turnId) &&
    isOptionalNumber(value.turnIndex) &&
    isOptional(value.status, isAgentStatus) &&
    isString(value.message) &&
    isReviewEvent(value.event)
  );
}

export function isSubmitReviewRequest(value: unknown): value is SubmitReviewRequest {
  return (
    isRecord(value) &&
    isArrayOf(value.comments, isComment) &&
    isOptional(value.reviewScope, isReviewScope)
  );
}

export function isResolutionRequest(value: unknown): value is ResolutionRequest {
  return isRecord(value) && isOptionalString(value.summary) && isOptionalString(value.turn);
}

export function isReviewRecord(value: unknown): value is ReviewRecord {
  return (
    isRecord(value) &&
    isReviewMeta(value.meta) &&
    isArrayOf(value.turns, isReviewTurn) &&
    isDiffPayload(value.diff) &&
    isOptional(value.feedback, isFeedbackBundle) &&
    isOptional(value.resolution, isResolutionBundle) &&
    isOptional(value.events, (events): events is ReviewEvent[] => isArrayOf(events, isReviewEvent))
  );
}

export function isStoredReviewMeta(value: unknown): value is StoredReviewMeta {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.cwd) &&
    isBaseRef(value.base) &&
    isNullableString(value.branch) &&
    isReviewStatus(value.status) &&
    isString(value.createdAt) &&
    isOptionalString(value.submittedAt) &&
    isOptionalString(value.resolvedAt) &&
    isOptionalString(value.artifactDir) &&
    isOptionalString(value.activeTurnId) &&
    isOptional(value.turns, (turns): turns is ReviewTurnSummary[] =>
      isArrayOf(turns, isReviewTurnSummary)
    ) &&
    isOptionalString(value.feedbackPath) &&
    isOptionalString(value.markdownPath)
  );
}

function isReviewMeta(value: unknown): value is ReviewMeta {
  return isStoredReviewMeta(value) && isString(value.artifactDir);
}

function hasReviewRegistrationFields(
  value: Record<string, unknown>
): value is Record<string, unknown> & ReviewRegistrationResponseShape {
  return isReviewMeta(value.meta) && isString(value.url);
}

export function isDiffPayload(value: unknown): value is DiffPayload {
  return (
    isRecord(value) &&
    isBaseRef(value.base) &&
    isNullableString(value.branch) &&
    isString(value.cwd) &&
    isDiffScope(value.scope) &&
    isDiffStats(value.stats) &&
    isString(value.rawDiff) &&
    isArrayOf(value.files, isDiffFile) &&
    isOptional(value.commitDiffs, (commitDiffs): commitDiffs is CommitDiff[] =>
      isArrayOf(commitDiffs, isCommitDiff)
    ) &&
    isString(value.capturedAt)
  );
}

export function isFeedbackBundle(value: unknown): value is FeedbackBundle {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isString(value.reviewId) &&
    isOptionalString(value.turnId) &&
    isOptionalNumber(value.turnIndex) &&
    isString(value.timestamp) &&
    isBaseRef(value.base) &&
    isNullableString(value.branch) &&
    isOptional(value.reviewScope, isReviewScope) &&
    isArrayOf(value.comments, isComment)
  );
}

export function isResolutionBundle(value: unknown): value is ResolutionBundle {
  return (
    isRecord(value) &&
    isString(value.reviewId) &&
    isOptionalString(value.turnId) &&
    isOptionalNumber(value.turnIndex) &&
    isResolutionStatus(value.status) &&
    isNullableString(value.summary) &&
    isNullableString(value.resolvedAt) &&
    isArrayOf(value.comments, isResolvedComment)
  );
}

export function isReviewEvent(value: unknown): value is ReviewEvent {
  if (!isRecord(value) || !isString(value.reviewId) || !isString(value.type)) {
    return false;
  }
  if (!hasValidReviewEventEnvelope(value)) {
    return false;
  }
  switch (value.type) {
    case 'review.opened':
    case 'review.cancelled':
      return true;
    case 'review.turn.created':
      return isString(value.turnId) && isNumber(value.turnIndex) && isBoolean(value.reused);
    case 'review.submitted':
      return (
        isOptionalString(value.turnId) &&
        isOptionalNumber(value.turnIndex) &&
        isRecord(value.counts) &&
        isNumber(value.counts.files) &&
        isNumber(value.counts.comments)
      );
    case 'review.updated':
      return (
        isOptionalString(value.turnId) &&
        isOptionalNumber(value.turnIndex) &&
        isReviewUpdateReason(value.reason) &&
        isReviewStatus(value.status) &&
        isResolutionStatus(value.resolutionStatus) &&
        isResolutionCounts(value.counts)
      );
    case 'agent.claimed':
      return (
        isString(value.turnId) &&
        isNumber(value.turnIndex) &&
        value.status === 'claimed' &&
        isOptionalString(value.message)
      );
    case 'agent.note':
      return (
        isOptionalString(value.turnId) &&
        isOptionalNumber(value.turnIndex) &&
        isOptional(value.status, isAgentStatus) &&
        isString(value.message)
      );
    default:
      return false;
  }
}

export function isReviewTurnMeta(value: unknown): value is ReviewTurnMeta {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isNumber(value.index) &&
    isReviewStatus(value.status) &&
    isString(value.createdAt) &&
    isOptionalString(value.submittedAt) &&
    isOptionalString(value.resolvedAt) &&
    isString(value.artifactDir) &&
    isString(value.diffPath) &&
    isOptionalString(value.feedbackPath) &&
    isOptionalString(value.markdownPath) &&
    isOptionalString(value.resolvedPath)
  );
}

function isReviewTurnSummary(value: unknown): value is ReviewTurnSummary {
  if (!isRecord(value) || !isReviewTurnMeta(value)) {
    return false;
  }
  return (
    isString(value.capturedAt) && isDiffStats(value.stats) && isResolutionCounts(value.comments)
  );
}

function isReviewTurn(value: unknown): value is ReviewTurn {
  if (!isRecord(value) || !isReviewTurnMeta(value)) {
    return false;
  }
  return (
    isDiffPayload(value.diff) &&
    isOptional(value.feedback, isFeedbackBundle) &&
    isOptional(value.resolution, isResolutionBundle)
  );
}

function isClearReviewEntry(value: unknown): value is ClearReviewEntry {
  return (
    isRecord(value) &&
    isString(value.reviewId) &&
    isReviewStatus(value.status) &&
    isString(value.artifactDir) &&
    isString(value.lastActivityAt)
  );
}

function isClearReviewSkipped(value: unknown): value is ClearReviewsResult['skipped'][number] {
  return (
    isRecord(value) &&
    isString(value.reviewId) &&
    isString(value.artifactDir) &&
    isString(value.reason)
  );
}

function isDiffScope(value: unknown): value is DiffPayload['scope'] {
  return (
    isRecord(value) &&
    isOneOf(value.mode, DIFF_SCOPE_MODES) &&
    isNullableString(value.requestedBase) &&
    isBaseRef(value.base) &&
    isDiffRef(value.comparison) &&
    (value.fallbackReason === null || isOneOf(value.fallbackReason, DIFF_FALLBACK_REASONS))
  );
}

function isDiffRef(value: unknown): value is DiffPayload['scope']['comparison'] {
  return isRecord(value) && isString(value.ref) && isNullableString(value.sha);
}

function isBaseRef(value: unknown): value is { ref: string; sha: string } {
  return isRecord(value) && isString(value.ref) && isString(value.sha);
}

function isDiffStats(value: unknown): value is DiffStats {
  return (
    isRecord(value) &&
    isNumber(value.files) &&
    isNumber(value.additions) &&
    isNumber(value.deletions)
  );
}

function isDiffCommit(value: unknown): value is DiffCommit {
  return (
    isRecord(value) &&
    isString(value.sha) &&
    isString(value.shortSha) &&
    isString(value.subject) &&
    isString(value.authorName) &&
    isString(value.authorEmail) &&
    isString(value.authoredAt) &&
    isString(value.committedAt)
  );
}

function isCommitDiff(value: unknown): value is CommitDiff {
  return (
    isRecord(value) &&
    isDiffCommit(value.commit) &&
    isDiffStats(value.stats) &&
    isString(value.rawDiff) &&
    isArrayOf(value.files, isDiffFile)
  );
}

function isDiffContextSource(value: unknown): value is DiffContextSource {
  if (!isRecord(value) || !isString(value.mode)) {
    return false;
  }
  switch (value.mode) {
    case 'turn':
      return true;
    case 'commit':
      return isString(value.sha);
    case 'range':
      return isString(value.fromSha) && isString(value.toSha);
    default:
      return false;
  }
}

function isReviewScope(value: unknown): value is ReviewScope {
  if (!isRecord(value) || !isOneOf(value.mode, REVIEW_SCOPE_MODES)) {
    return false;
  }
  switch (value.mode) {
    case 'all':
      return true;
    case 'single':
      return isString(value.sha);
    case 'range':
      return isString(value.fromSha) && isString(value.toSha);
  }
}

function isDiffFile(value: unknown): value is DiffFile {
  return (
    isRecord(value) &&
    isString(value.path) &&
    isNullableString(value.oldPath) &&
    isNumber(value.additions) &&
    isNumber(value.deletions) &&
    isBoolean(value.isBinary) &&
    isBoolean(value.isDeleted) &&
    isBoolean(value.isNew) &&
    isBoolean(value.isRenamed) &&
    isNullableString(value.language) &&
    isArrayOf(value.hunks, isDiffHunk)
  );
}

function isDiffHunk(value: unknown): value is DiffHunk {
  return (
    isRecord(value) &&
    isNumber(value.oldStart) &&
    isNumber(value.oldLines) &&
    isNumber(value.newStart) &&
    isNumber(value.newLines) &&
    isString(value.header) &&
    isArrayOf(value.lines, isDiffLine)
  );
}

function isDiffLine(value: unknown): value is DiffLine {
  return (
    isRecord(value) &&
    isOneOf(value.type, DIFF_LINE_TYPES) &&
    isNullableNumber(value.oldLine) &&
    isNullableNumber(value.newLine) &&
    isString(value.content)
  );
}

function isComment(value: unknown): value is Comment {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === 'general') {
    return isString(value.id) && isString(value.body) && isString(value.createdAt);
  }
  return (
    isString(value.id) &&
    (value.kind === undefined || value.kind === 'line') &&
    isString(value.filePath) &&
    isNumber(value.startLine) &&
    isNumber(value.endLine) &&
    isOneOf(value.side, SIDES) &&
    isString(value.body) &&
    isString(value.originalSnippet) &&
    isString(value.createdAt)
  );
}

function isResolvedComment(value: unknown): value is ResolvedComment {
  return (
    isRecord(value) &&
    isString(value.commentId) &&
    value.status === 'resolved' &&
    isOptionalString(value.summary) &&
    isString(value.resolvedAt)
  );
}

function isResolutionCounts(value: unknown): value is ResolveResult['comments'] {
  return (
    isRecord(value) && isNumber(value.total) && isNumber(value.resolved) && isNumber(value.open)
  );
}

function isReviewStatus(value: unknown): value is ReviewMeta['status'] {
  return isOneOf(value, REVIEW_STATUSES);
}

function isResolutionStatus(value: unknown): value is ResolutionBundle['status'] {
  return isOneOf(value, RESOLUTION_STATUSES);
}

function isSourcePeekMatchReason(value: unknown): value is SourcePeekMatchReason {
  return isOneOf(value, SOURCE_PEEK_MATCH_REASONS);
}

function isOpenFileScope(value: unknown): value is OpenFileScope {
  return isOneOf(value, OPEN_FILE_SCOPES);
}

function isOpenFileTarget(value: unknown): value is OpenFileTarget {
  return isOneOf(value, OPEN_FILE_TARGETS);
}

function isOpenFileTargetInfo(value: unknown): value is OpenFileTargetInfo {
  return isRecord(value) && isOpenFileTarget(value.target) && isString(value.label);
}

function isReviewUpdateReason(
  value: unknown
): value is Extract<ReviewEvent, { type: 'review.updated' }>['reason'] {
  return isOneOf(value, REVIEW_UPDATE_REASONS);
}

function isReviewEventActor(value: unknown): value is ReviewEventActor {
  return isOneOf(value, REVIEW_EVENT_ACTORS);
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return isOneOf(value, AGENT_STATUSES);
}

function hasValidReviewEventEnvelope(value: Record<string, unknown>): boolean {
  return (
    isOptionalString(value.id) &&
    isOptionalNumber(value.seq) &&
    isOptionalString(value.createdAt) &&
    isOptional(value.actor, isReviewEventActor)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArrayOf<T>(value: unknown, guard: JsonGuard<T>): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

function isOptional<T>(value: unknown, guard: JsonGuard<T>): value is T | undefined {
  return value === undefined || guard(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function isIdentifier(value: unknown): value is string {
  return isString(value) && /^[A-Za-z_$][\w$]*$/.test(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || isNumber(value);
}

function isOptionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || (isNumber(value) && Number.isInteger(value) && value >= 0);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || isBoolean(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  options: T
): value is T[number] {
  return typeof value === 'string' && options.includes(value);
}
