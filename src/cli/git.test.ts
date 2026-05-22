import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { captureDiff } from './git';

const repos: string[] = [];

async function git(args: string[], cwd: string): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trimEnd();
}

async function createRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'gloss-git-'));
  repos.push(repo);
  await git(['init', '-b', 'main'], repo);
  await git(['config', 'user.email', 'gloss@example.com'], repo);
  await git(['config', 'user.name', 'Gloss Test'], repo);
  return repo;
}

async function write(repo: string, filePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(repo, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function commitAll(repo: string, message: string): Promise<void> {
  await git(['add', '.'], repo);
  await git(['commit', '-m', message], repo);
}

async function seedRepo(): Promise<string> {
  const repo = await createRepo();
  await write(repo, 'app.ts', 'export const value = 1;\n');
  await commitAll(repo, 'initial');
  return repo;
}

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('captureDiff', () => {
  it('shows staged, unstaged, and untracked working changes first', async () => {
    const repo = await seedRepo();
    await write(repo, 'app.ts', 'export const value = 2;\n');
    await write(repo, 'staged.ts', 'export const staged = true;\n');
    await git(['add', 'staged.ts'], repo);
    await write(repo, 'untracked.ts', 'export const untracked = true;\n');

    const diff = await captureDiff(undefined, repo);

    expect(diff.scope).toMatchObject({
      mode: 'working',
      requestedBase: null,
      fallbackReason: null,
      base: { ref: 'HEAD' },
      comparison: { ref: 'working tree', sha: null }
    });
    expect(diff.files.map((file) => file.path).sort()).toEqual([
      'app.ts',
      'staged.ts',
      'untracked.ts'
    ]);
    expect(diff.stats).toMatchObject({ files: 3, additions: 3, deletions: 1 });
  });

  it('falls back to the branch diff when the working tree is clean', async () => {
    const repo = await seedRepo();
    const mainSha = await git(['rev-parse', 'main'], repo);
    await git(['update-ref', 'refs/remotes/origin/main', mainSha], repo);
    await git(['switch', '-c', 'feature'], repo);
    await write(repo, 'feature.ts', 'export const feature = true;\n');
    await commitAll(repo, 'feature');

    const diff = await captureDiff(undefined, repo);

    expect(diff.scope).toMatchObject({
      mode: 'branch',
      requestedBase: null,
      fallbackReason: 'working-tree-clean',
      base: { ref: 'merge-base(origin/main)', sha: mainSha },
      comparison: { ref: 'HEAD' }
    });
    expect(diff.branch).toBe('feature');
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({ path: 'feature.ts', additions: 1, deletions: 0 });
    expect(diff.stats).toMatchObject({ files: 1, additions: 1, deletions: 0 });
  });

  it('keeps explicit base behavior without branch fallback', async () => {
    const repo = await seedRepo();
    const mainSha = await git(['rev-parse', 'main'], repo);
    await git(['update-ref', 'refs/remotes/origin/main', mainSha], repo);
    await git(['switch', '-c', 'feature'], repo);
    await write(repo, 'feature.ts', 'export const feature = true;\n');
    await commitAll(repo, 'feature');

    const diff = await captureDiff('HEAD', repo);

    expect(diff.scope).toMatchObject({
      mode: 'explicit',
      requestedBase: 'HEAD',
      fallbackReason: null,
      comparison: { ref: 'working tree', sha: null }
    });
    expect(diff.files).toHaveLength(0);
    expect(diff.stats).toMatchObject({ files: 0, additions: 0, deletions: 0 });
  });

  it('returns an empty working review when no branch base can be resolved', async () => {
    const repo = await seedRepo();

    const diff = await captureDiff(undefined, repo);

    expect(diff.scope).toMatchObject({
      mode: 'working',
      requestedBase: null,
      fallbackReason: 'missing-branch-base',
      base: { ref: 'HEAD' },
      comparison: { ref: 'working tree', sha: null }
    });
    expect(diff.files).toHaveLength(0);
    expect(diff.stats).toMatchObject({ files: 0, additions: 0, deletions: 0 });
  });
});
