import { execa } from 'execa';
import type { DiffPayload } from '../shared/types';
import { parseUnifiedDiff } from './diff-parser';

async function git(args: string[], cwd = process.cwd()): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trimEnd();
}

async function gitLenient(args: string[], cwd: string): Promise<string> {
  const result = await execa('git', args, { cwd, reject: false });
  if (result.exitCode !== 0 && result.stdout.length === 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trimEnd();
}

export async function getRepoRoot(cwd = process.cwd()): Promise<string> {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

export async function captureDiff(baseRef = 'HEAD', cwd = process.cwd()): Promise<DiffPayload> {
  const repoRoot = await getRepoRoot(cwd);
  const [baseSha, branchResult, trackedDiff, untrackedFilesRaw] = await Promise.all([
    git(['rev-parse', baseRef], repoRoot),
    execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, reject: false }),
    git(['diff', '--no-color', '--find-renames', '--find-copies', baseRef, '--'], repoRoot),
    git(['ls-files', '--others', '--exclude-standard', '-z'], repoRoot)
  ]);

  const untrackedFiles = untrackedFilesRaw.split('\0').filter(Boolean);
  const untrackedDiffs = await Promise.all(
    untrackedFiles.map((filePath) =>
      gitLenient(['diff', '--no-color', '--no-index', '--', '/dev/null', filePath], repoRoot)
    )
  );
  const rawDiff = [trackedDiff, ...untrackedDiffs].filter(Boolean).join('\n');
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : null;

  return {
    base: { ref: baseRef, sha: baseSha },
    branch: branch && branch !== 'HEAD' ? branch : null,
    cwd: repoRoot,
    rawDiff,
    files: parseUnifiedDiff(rawDiff),
    capturedAt: new Date().toISOString()
  };
}

export async function assertGitAvailable(): Promise<void> {
  await execa('git', ['--version']);
}
