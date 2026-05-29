import { execa } from 'execa';
import { parseUnifiedDiff } from '../shared/diff-parser';
import { summarizeDiffFiles } from '../shared/diff-stats';
import type {
  BaseRef,
  CommitDiff,
  DiffFallbackReason,
  DiffPayload,
  DiffRef,
  DiffScopeMode
} from '../shared/types';

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
  base: BaseRef;
  mode: DiffScopeMode;
  requestedBase: string | null;
  comparison: DiffRef;
  fallbackReason: DiffFallbackReason;
  commitDiffs?: CommitDiff[];
}

function buildPayload({
  repoRoot,
  branch,
  rawDiff,
  base,
  mode,
  requestedBase,
  comparison,
  fallbackReason,
  commitDiffs
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
    stats: summarizeDiffFiles(files),
    rawDiff,
    files,
    ...(commitDiffs ? { commitDiffs } : {}),
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

async function captureCommitDiffs(
  baseSha: string,
  comparisonRef: string,
  repoRoot: string
): Promise<CommitDiff[]> {
  const rawLog = await gitMaybe(
    [
      'log',
      '--reverse',
      '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x1e',
      `${baseSha}..${comparisonRef}`
    ],
    repoRoot
  );
  if (!rawLog) {
    return [];
  }

  const commits = rawLog
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [
        sha = '',
        shortSha = '',
        authorName = '',
        authorEmail = '',
        authoredAt = '',
        committedAt = '',
        ...subjectParts
      ] = entry.split('\x00');
      return {
        sha,
        shortSha,
        subject: subjectParts.join('\x00'),
        authorName,
        authorEmail,
        authoredAt,
        committedAt
      };
    })
    .filter((commit) => commit.sha && commit.shortSha);

  const commitDiffs: CommitDiff[] = [];
  for (const commit of commits) {
    const rawDiff = await git([...DIFF_ARGS, `${commit.sha}^`, commit.sha, '--'], repoRoot);
    const files = parseUnifiedDiff(rawDiff);
    commitDiffs.push({
      commit,
      stats: summarizeDiffFiles(files),
      rawDiff,
      files
    });
  }
  return commitDiffs;
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

  const [rawDiff, commitDiffs] = await Promise.all([
    git([...DIFF_ARGS, branchBase.mergeBaseSha, 'HEAD', '--'], repoRoot),
    captureCommitDiffs(branchBase.mergeBaseSha, 'HEAD', repoRoot)
  ]);
  return buildPayload({
    repoRoot,
    branch,
    rawDiff,
    base: { ref: `merge-base(${branchBase.sourceRef})`, sha: branchBase.mergeBaseSha },
    mode: 'branch',
    requestedBase: null,
    comparison: { ref: 'HEAD', sha: headSha },
    fallbackReason: 'working-tree-clean',
    commitDiffs
  });
}

export async function assertGitAvailable(): Promise<void> {
  await execa('git', ['--version']);
}
