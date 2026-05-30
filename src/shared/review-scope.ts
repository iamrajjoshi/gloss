import type { CommitDiff, DiffPayload, ReviewScope } from './types';

const ALL_REVIEW_SCOPE: ReviewScope = { mode: 'all' };

export function normalizeReviewScope(
  diff: Pick<DiffPayload, 'commitDiffs'>,
  scope: ReviewScope = ALL_REVIEW_SCOPE
): ReviewScope {
  if (scope.mode === 'all') {
    return ALL_REVIEW_SCOPE;
  }

  const commitDiffs = diff.commitDiffs ?? [];
  if (commitDiffs.length === 0) {
    throw new Error('Review scope requires a review with per-commit diffs');
  }

  if (scope.mode === 'single') {
    const commit = commitDiffs.find((commitDiff) => commitDiff.commit.sha === scope.sha);
    if (!commit) {
      throw new Error('Review scope must use commits from this review');
    }
    return { mode: 'single', sha: commit.commit.sha };
  }

  const fromIndex = commitDiffs.findIndex((commitDiff) => commitDiff.commit.sha === scope.fromSha);
  const toIndex = commitDiffs.findIndex((commitDiff) => commitDiff.commit.sha === scope.toSha);
  if (fromIndex < 0 || toIndex < 0) {
    throw new Error('Review scope must use commits from this review');
  }
  if (fromIndex > toIndex) {
    throw new Error('Review scope range must be in review order');
  }
  return {
    mode: 'range',
    fromSha: commitDiffs[fromIndex].commit.sha,
    toSha: commitDiffs[toIndex].commit.sha
  };
}

export function sameReviewScope(left?: ReviewScope, right?: ReviewScope): boolean {
  return JSON.stringify(left ?? ALL_REVIEW_SCOPE) === JSON.stringify(right ?? ALL_REVIEW_SCOPE);
}

export function reviewScopeLabel(
  scope: ReviewScope = ALL_REVIEW_SCOPE,
  commitDiffs: CommitDiff[] = []
): string {
  if (scope.mode === 'all') {
    return 'All commits';
  }
  if (scope.mode === 'single') {
    const commit = commitDiffs.find((commitDiff) => commitDiff.commit.sha === scope.sha);
    return commit
      ? `${commit.commit.shortSha} ${commit.commit.subject}`
      : `Commit ${shortSha(scope.sha)}`;
  }

  const fromIndex = commitDiffs.findIndex((commitDiff) => commitDiff.commit.sha === scope.fromSha);
  const toIndex = commitDiffs.findIndex((commitDiff) => commitDiff.commit.sha === scope.toSha);
  if (fromIndex >= 0 && toIndex >= fromIndex) {
    const count = toIndex - fromIndex + 1;
    return `${count} commits · ${commitDiffs[fromIndex].commit.shortSha} to ${
      commitDiffs[toIndex].commit.shortSha
    }`;
  }
  return `Commit range ${shortSha(scope.fromSha)} to ${shortSha(scope.toSha)}`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
