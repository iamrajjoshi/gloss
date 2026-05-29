import type { DiffPayload, ReviewRecord } from './types';

export function reviewDisplayTitle(record: ReviewRecord): string {
  const branch = (record.meta.branch ?? record.diff.branch)?.trim();
  if (branch) {
    return branch;
  }

  return diffScopeTitle(record.diff);
}

function diffScopeTitle(diff: DiffPayload): string {
  switch (diff.scope.mode) {
    case 'branch':
      return 'Branch diff';
    case 'explicit':
      return `Diff against ${diff.scope.requestedBase ?? diff.base.ref}`;
    case 'working':
      return 'Working changes';
  }
}
