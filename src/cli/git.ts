import { execa } from 'execa';
import type {
  DiffFallbackReason,
  DiffFile,
  DiffPayload,
  DiffScopeMode,
  DiffStats
} from '../shared/types';
import { parseUnifiedDiff } from './diff-parser';

const DIFF_ARGS = ['diff', '--no-color', '--find-renames', '--find-copies'];

async function git(args: string[], cwd = process.cwd()): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trimEnd();
}

async function gitMaybe(args: string[], cwd: string): Promise<string | null> {
  const result = await execa('git', args, { cwd, reject: false });
  return result.exitCode === 0 ? result.stdout.trimEnd() : null;
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

interface ResolvedBranchBase {
  sourceRef: string;
  mergeBaseSha: string;
}

interface PayloadOptions {
  repoRoot: string;
  branch: string | null;
  rawDiff: string;
  base: { ref: string; sha: string };
  mode: DiffScopeMode;
  requestedBase: string | null;
  comparison: { ref: string; sha: string | null };
  fallbackReason: DiffFallbackReason;
}

function summarize(files: DiffFile[]): DiffStats {
  return files.reduce(
    (stats, file) => ({
      files: stats.files + 1,
      additions: stats.additions + file.additions,
      deletions: stats.deletions + file.deletions
    }),
    { files: 0, additions: 0, deletions: 0 }
  );
}

function buildPayload({
  repoRoot,
  branch,
  rawDiff,
  base,
  mode,
  requestedBase,
  comparison,
  fallbackReason
}: PayloadOptions): DiffPayload {
  const files = parseUnifiedDiff(rawDiff);
  return {
    base,
    branch,
    cwd: repoRoot,
    scope: {
      mode,
      requestedBase,
      base,
      comparison,
      fallbackReason
    },
    stats: summarize(files),
    rawDiff,
    files,
    capturedAt: new Date().toISOString()
  };
}

async function currentBranch(repoRoot: string): Promise<string | null> {
  const branch = await gitMaybe(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  return branch && branch !== 'HEAD' ? branch : null;
}

async function captureUntrackedDiff(repoRoot: string): Promise<string[]> {
  const untrackedFilesRaw = await git(
    ['ls-files', '--others', '--exclude-standard', '-z'],
    repoRoot
  );
  const untrackedFiles = untrackedFilesRaw.split('\0').filter(Boolean);
  return Promise.all(
    untrackedFiles.map((filePath) =>
      gitLenient(['diff', '--no-color', '--no-index', '--', '/dev/null', filePath], repoRoot)
    )
  );
}

async function captureWorkingDiff(baseRef: string, repoRoot: string): Promise<string> {
  const [trackedDiff, untrackedDiffs] = await Promise.all([
    git([...DIFF_ARGS, baseRef, '--'], repoRoot),
    captureUntrackedDiff(repoRoot)
  ]);
  return [trackedDiff, ...untrackedDiffs].filter(Boolean).join('\n');
}

async function resolveCommit(ref: string, repoRoot: string): Promise<string | null> {
  return gitMaybe(['rev-parse', '--verify', `${ref}^{commit}`], repoRoot);
}

async function resolveBranchBase(repoRoot: string): Promise<ResolvedBranchBase | null> {
  const candidates: string[] = [];
  const upstream = await gitMaybe(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    repoRoot
  );
  const originHead = await gitMaybe(
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    repoRoot
  );

  for (const ref of [upstream, originHead, 'origin/main', 'origin/master']) {
    if (ref && !candidates.includes(ref)) {
      candidates.push(ref);
    }
  }

  for (const sourceRef of candidates) {
    const [sourceSha, mergeBaseSha] = await Promise.all([
      resolveCommit(sourceRef, repoRoot),
      gitMaybe(['merge-base', 'HEAD', sourceRef], repoRoot)
    ]);
    if (sourceSha && mergeBaseSha) {
      return { sourceRef, mergeBaseSha };
    }
  }

  return null;
}

export async function captureDiff(baseRef?: string, cwd = process.cwd()): Promise<DiffPayload> {
  const repoRoot = await getRepoRoot(cwd);
  const [headSha, branch] = await Promise.all([
    git(['rev-parse', 'HEAD'], repoRoot),
    currentBranch(repoRoot)
  ]);

  if (baseRef) {
    const [baseSha, rawDiff] = await Promise.all([
      git(['rev-parse', baseRef], repoRoot),
      captureWorkingDiff(baseRef, repoRoot)
    ]);
    return buildPayload({
      repoRoot,
      branch,
      rawDiff,
      base: { ref: baseRef, sha: baseSha },
      mode: 'explicit',
      requestedBase: baseRef,
      comparison: { ref: 'working tree', sha: null },
      fallbackReason: null
    });
  }

  const workingDiff = await captureWorkingDiff('HEAD', repoRoot);
  if (workingDiff.trim().length > 0) {
    return buildPayload({
      repoRoot,
      branch,
      rawDiff: workingDiff,
      base: { ref: 'HEAD', sha: headSha },
      mode: 'working',
      requestedBase: null,
      comparison: { ref: 'working tree', sha: null },
      fallbackReason: null
    });
  }

  const branchBase = await resolveBranchBase(repoRoot);
  if (!branchBase) {
    return buildPayload({
      repoRoot,
      branch,
      rawDiff: '',
      base: { ref: 'HEAD', sha: headSha },
      mode: 'working',
      requestedBase: null,
      comparison: { ref: 'working tree', sha: null },
      fallbackReason: 'missing-branch-base'
    });
  }

  const rawDiff = await git([...DIFF_ARGS, branchBase.mergeBaseSha, 'HEAD', '--'], repoRoot);
  return buildPayload({
    repoRoot,
    branch,
    rawDiff,
    base: { ref: `merge-base(${branchBase.sourceRef})`, sha: branchBase.mergeBaseSha },
    mode: 'branch',
    requestedBase: null,
    comparison: { ref: 'HEAD', sha: headSha },
    fallbackReason: 'working-tree-clean'
  });
}

export async function assertGitAvailable(): Promise<void> {
  await execa('git', ['--version']);
}
