import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { parseUnifiedDiff } from './diff-parser';
import { summarizeDiffFiles } from './diff-stats';
import { sortDiffFiles } from './file-order';
import type { CommitDiff, DiffContextResponse, DiffLine } from './types';

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
  const files = sortDiffFiles(parseUnifiedDiff(rawDiff));
  return {
    stats: summarizeDiffFiles(files),
    rawDiff,
    files
  };
}

export async function captureDiffContext({
  filePath,
  lineCount,
  newRef,
  oldPath,
  oldRef,
  newStart,
  oldStart,
  repoRoot
}: {
  filePath: string;
  oldPath: string | null;
  oldRef: string | null;
  newRef: string | null;
  oldStart: number;
  newStart: number;
  lineCount: number;
  repoRoot: string;
}): Promise<DiffContextResponse> {
  const [oldLines, newLines] = await Promise.all([
    oldRef && oldPath ? readRevisionLines(repoRoot, oldRef, oldPath).catch(() => null) : null,
    newRef === null
      ? readWorkingTreeLines(repoRoot, filePath).catch(() => null)
      : readRevisionLines(repoRoot, newRef, filePath).catch(() => null)
  ]);

  if (!oldLines && !newLines) {
    throw new Error(`Could not read ${filePath} from either side of the diff`);
  }

  const lines: DiffLine[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const oldLine = oldStart + index;
    const newLine = newStart + index;
    const content = newLines?.[newLine - 1] ?? oldLines?.[oldLine - 1];
    if (content === undefined) {
      continue;
    }
    lines.push({
      type: 'context',
      oldLine,
      newLine,
      content
    });
  }

  return {
    filePath,
    oldStart,
    newStart,
    lines
  };
}

async function readRevisionLines(
  repoRoot: string,
  ref: string,
  filePath: string
): Promise<string[]> {
  const result = await execa('git', ['show', `${ref}:${filePath}`], { cwd: repoRoot });
  return splitFileLines(result.stdout);
}

async function readWorkingTreeLines(repoRoot: string, filePath: string): Promise<string[]> {
  return splitFileLines(await readFile(path.resolve(repoRoot, filePath), 'utf8'));
}

function splitFileLines(contents: string): string[] {
  const lines = contents.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}
