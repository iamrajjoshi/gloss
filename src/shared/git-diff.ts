import { execa } from 'execa';
import { parseUnifiedDiff } from './diff-parser';
import { summarizeDiffFiles } from './diff-stats';
import type { CommitDiff } from './types';

const DIFF_ARGS = ['diff', '--no-color', '--find-renames', '--find-copies'];

async function git(args: string[], cwd: string): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trimEnd();
}

export async function captureCommitRangeDiff(
  fromSha: string,
  toSha: string,
  repoRoot: string
): Promise<Pick<CommitDiff, 'stats' | 'rawDiff' | 'files'>> {
  const rawDiff = await git([...DIFF_ARGS, `${fromSha}^`, toSha, '--'], repoRoot);
  const files = parseUnifiedDiff(rawDiff);
  return {
    stats: summarizeDiffFiles(files),
    rawDiff,
    files
  };
}
