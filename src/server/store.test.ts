import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  globalReviewDiffFile,
  globalReviewDir,
  globalReviewEventsFile,
  globalReviewFeedbackFile,
  globalReviewMarkdownFile,
  globalReviewMetaFile,
  globalReviewTurnFeedbackFile,
  globalReviewTurnMarkdownFile,
  globalReviewTurnMetaFile,
  globalReviewTurnResolvedFile
} from '../shared/paths';
import { isResolutionBundle, isReviewEvent, parseJson } from '../shared/validation';
import { makeComment, makeDiff } from '../test/factories';
import { ReviewStore } from './store';

const originalStateDir = process.env.GLOSS_STATE_DIR;
let tempDirs: string[] = [];
let repoRoot = '';

beforeEach(async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-state-'));
  repoRoot = await mkdtemp(path.join(tmpdir(), 'gloss-repo-'));
  tempDirs = [stateDir, repoRoot];
  process.env.GLOSS_STATE_DIR = stateDir;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalStateDir === undefined) {
    delete process.env.GLOSS_STATE_DIR;
  } else {
    process.env.GLOSS_STATE_DIR = originalStateDir;
  }
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ReviewStore global persistence', () => {
  it('stores reviews globally without writing repo-local artifacts', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeStoreDiff());

    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);
    expect(existsSync(record.meta.artifactDir)).toBe(true);

    const {
      record: submitted,
      feedbackPath,
      markdownPath,
      turn
    } = await store.submit(record.meta.id, [makeComment()]);

    expect(submitted.meta.status).toBe('submitted');
    expect(submitted.meta.submittedAt).toBeTruthy();
    expect(submitted.meta.feedbackPath).toBe(feedbackPath);
    expect(submitted.meta.markdownPath).toBe(markdownPath);
    expect(feedbackPath).toBe(globalReviewTurnFeedbackFile(record.meta.id, turn.id));
    expect(markdownPath).toBe(globalReviewTurnMarkdownFile(record.meta.id, turn.id));
    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);

    const reloaded = new ReviewStore();
    const reviews = await reloaded.list();
    const loaded = await reloaded.get(record.meta.id);

    expect(reviews).toHaveLength(1);
    expect(loaded?.meta.status).toBe('submitted');
    expect(loaded?.feedback?.comments).toHaveLength(1);
    expect(await reloaded.feedback(record.meta.id)).toEqual(loaded?.feedback);

    const result = await reloaded.markResolved(record.meta.id, 'fixed locally');
    const resolvedPath = result.path;
    const resolved = await reloaded.get(record.meta.id);
    const resolvedPayload = parseJson(
      await readFile(resolvedPath, 'utf8'),
      isResolutionBundle,
      'review resolution'
    );

    expect(resolvedPath).toBe(globalReviewTurnResolvedFile(record.meta.id, turn.id));
    expect(resolved?.meta.status).toBe('resolved');
    expect(resolved?.resolution).toEqual(resolvedPayload);
    expect(resolvedPayload).toMatchObject({
      reviewId: record.meta.id,
      status: 'resolved',
      summary: 'fixed locally',
      comments: [{ commentId: 'comment-1', status: 'resolved' }]
    });
    expect(existsSync(path.join(repoRoot, '.gloss'))).toBe(false);
  });

  it('tracks comment-level resolution progress separately from submitted feedback', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeStoreDiff());
    await store.submit(record.meta.id, [
      makeComment({ id: 'comment-1' }),
      makeComment({ id: 'comment-2' })
    ]);

    const partial = await store.resolveComment(record.meta.id, 'comment-1', 'fixed first item');
    const partiallyResolved = await store.get(record.meta.id);
    const partialPayload = parseJson(
      await readFile(partial.path, 'utf8'),
      isResolutionBundle,
      'review resolution'
    );

    expect(partial).toMatchObject({
      status: 'submitted',
      resolutionStatus: 'partial',
      comments: { total: 2, resolved: 1, open: 1 },
      path: expect.stringContaining('/turns/')
    });
    expect(partiallyResolved?.meta.status).toBe('submitted');
    expect(partiallyResolved?.feedback?.comments).toHaveLength(2);
    expect(partialPayload).toMatchObject({
      reviewId: record.meta.id,
      status: 'partial',
      summary: null,
      comments: [{ commentId: 'comment-1', summary: 'fixed first item' }]
    });

    const complete = await store.resolveComment(record.meta.id, 'comment-2');
    const resolved = await store.get(record.meta.id);

    expect(complete).toMatchObject({
      status: 'resolved',
      resolutionStatus: 'resolved',
      comments: { total: 2, resolved: 2, open: 0 }
    });
    expect(resolved?.meta.status).toBe('resolved');

    const reopened = await store.reopenComment(record.meta.id, 'comment-1');
    const reopenedRecord = await store.get(record.meta.id);

    expect(reopened).toMatchObject({
      status: 'submitted',
      resolutionStatus: 'partial',
      comments: { total: 2, resolved: 1, open: 1 }
    });
    expect(reopenedRecord?.meta.status).toBe('submitted');
    expect(reopenedRecord?.resolution?.comments.map((comment) => comment.commentId)).toEqual([
      'comment-2'
    ]);
  });

  it('persists and replays ordered review timeline events', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeStoreDiff());
    await store.submit(record.meta.id, [makeComment({ id: 'comment-1' })]);
    const claim = await store.claim(record.meta.id);
    const note = await store.addAgentNote(record.meta.id, 'Applying feedback.', 'working');
    await store.resolveComment(record.meta.id, 'comment-1', 'fixed locally');

    const events = await store.events(record.meta.id);
    const rawEvents = (await readFile(globalReviewEventsFile(record.meta.id), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => parseJson(line, isReviewEvent, 'review event'));

    expect(events.map((event) => event.type)).toEqual([
      'review.opened',
      'review.submitted',
      'agent.claimed',
      'agent.note',
      'review.updated'
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(rawEvents).toEqual(events);
    expect(claim.event.seq).toBe(3);
    expect(note.event).toMatchObject({
      type: 'agent.note',
      status: 'working',
      message: 'Applying feedback.'
    });
    await expect(store.events(record.meta.id, 3)).resolves.toMatchObject([
      { type: 'agent.note', seq: 4 },
      { type: 'review.updated', seq: 5 }
    ]);
  });

  it('appends, reuses, and reloads review turns', async () => {
    const store = new ReviewStore();
    const first = await store.create(makeStoreDiff());
    const submitted = await store.submit(first.meta.id, [makeComment({ id: 'comment-1' })]);
    const secondDiff = makeStoreDiff({
      capturedAt: '2026-05-22T12:05:00.000Z',
      code: 'export const second = true;',
      filePath: 'second.ts'
    });

    const appended = await store.appendTurn(first.meta.id, secondDiff);
    const retried = await store.appendTurn(first.meta.id, secondDiff);

    expect(appended.reused).toBe(false);
    expect(retried.reused).toBe(true);
    expect(retried.turn.id).toBe(appended.turn.id);
    expect(appended.record.meta.activeTurnId).toBe(appended.turn.id);
    expect(appended.record.diff.files[0]?.path).toBe('second.ts');
    expect(appended.record.turns.map((turn) => turn.index)).toEqual([1, 2]);
    expect(appended.record.meta.turns?.map((turn) => turn.comments.total)).toEqual([1, 0]);
    await expect(
      store.appendTurn(
        first.meta.id,
        makeStoreDiff({ code: 'export const third = true;', filePath: 'third.ts' })
      )
    ).rejects.toThrow(/pending turn/);

    const reloaded = new ReviewStore();
    const loaded = await reloaded.get(first.meta.id);

    expect(loaded?.turns).toHaveLength(2);
    expect(loaded?.meta.activeTurnId).toBe(appended.turn.id);
    expect(loaded?.meta.status).toBe('pending');

    await reloaded.submit(first.meta.id, [
      makeComment({ id: 'comment-2', filePath: 'second.ts', originalSnippet: 'second' })
    ]);
    const resolvedFirstTurnComment = await reloaded.resolveComment(first.meta.id, 'comment-1');

    expect(submitted.turn.index).toBe(1);
    expect(resolvedFirstTurnComment.turnIndex).toBe(1);
  });

  it('synthesizes a timeline for existing reviews without an events file', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeStoreDiff());
    await store.submit(record.meta.id, [makeComment({ id: 'comment-1' })]);
    await store.markResolved(record.meta.id, 'fixed locally');
    await rm(globalReviewEventsFile(record.meta.id), { force: true });

    const reloaded = new ReviewStore();
    const loaded = await reloaded.get(record.meta.id);
    const events = await reloaded.events(record.meta.id);

    expect(loaded?.events?.map((event) => event.type)).toEqual([
      'review.opened',
      'review.submitted',
      'review.updated'
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(existsSync(globalReviewEventsFile(record.meta.id))).toBe(true);
  });

  it('persists the submitted commit scope for a turn', async () => {
    const store = new ReviewStore();
    const diff = makeStoreDiffWithCommits();
    const record = await store.create(diff);
    const reviewScope = {
      mode: 'range' as const,
      fromSha: diff.commitDiffs?.[0]?.commit.sha ?? '',
      toSha: diff.commitDiffs?.[1]?.commit.sha ?? ''
    };

    const submitted = await store.submit(record.meta.id, [makeComment()], reviewScope);
    const reloaded = await new ReviewStore().get(record.meta.id);
    const markdown = await readFile(submitted.markdownPath, 'utf8');

    expect(submitted.record.feedback?.reviewScope).toEqual(reviewScope);
    expect(reloaded?.feedback?.reviewScope).toEqual(reviewScope);
    expect(markdown).toContain('Review scope: Commit range 1234567 to abcdef1');
    await expect(
      store.submit(record.meta.id, [makeComment()], {
        mode: 'single',
        sha: diff.commitDiffs?.[0]?.commit.sha ?? ''
      })
    ).rejects.toThrow(/cannot be submitted/);
  });

  it('recovers the latest valid turn when root metadata is stale or a turn is incomplete', async () => {
    const store = new ReviewStore();
    const first = await store.create(makeStoreDiff());
    const submitted = await store.submit(first.meta.id, [makeComment({ id: 'comment-1' })]);
    const appended = await store.appendTurn(
      first.meta.id,
      makeStoreDiff({ capturedAt: '2026-05-22T12:10:00.000Z', filePath: 'second.ts' })
    );
    const staleMeta = {
      ...appended.record.meta,
      activeTurnId: submitted.turn.id,
      status: 'submitted',
      turns: appended.record.meta.turns?.filter((turn) => turn.id === submitted.turn.id)
    };
    await writeFile(globalReviewMetaFile(first.meta.id), `${JSON.stringify(staleMeta, null, 2)}\n`);

    const brokenTurnId = 'broken-turn';
    await mkdir(path.dirname(globalReviewTurnMetaFile(first.meta.id, brokenTurnId)), {
      recursive: true
    });
    await writeFile(
      globalReviewTurnMetaFile(first.meta.id, brokenTurnId),
      `${JSON.stringify({
        id: brokenTurnId,
        index: 99,
        status: 'pending',
        createdAt: '2026-05-22T12:11:00.000Z',
        artifactDir: path.dirname(globalReviewTurnMetaFile(first.meta.id, brokenTurnId)),
        diffPath: path.join(
          path.dirname(globalReviewTurnMetaFile(first.meta.id, brokenTurnId)),
          'diff.json'
        )
      })}\n`
    );

    const recovered = await new ReviewStore().get(first.meta.id);

    expect(recovered?.turns).toHaveLength(2);
    expect(recovered?.meta.activeTurnId).toBe(appended.turn.id);
    expect(recovered?.meta.status).toBe('pending');
    expect(recovered?.diff.files[0]?.path).toBe('second.ts');
  });

  it('preserves legacy root artifacts after a new persisted turn is appended', async () => {
    const reviewId = 'legacy-review';
    const legacyDiff = makeStoreDiff();
    const legacyFeedback = {
      version: 1 as const,
      reviewId,
      timestamp: '2026-05-22T12:01:00.000Z',
      base: legacyDiff.base,
      branch: legacyDiff.branch,
      comments: [makeComment({ id: 'legacy-comment' })]
    };
    await mkdir(globalReviewDir(reviewId), { recursive: true });
    await writeFile(
      globalReviewMetaFile(reviewId),
      `${JSON.stringify(
        {
          id: reviewId,
          cwd: repoRoot,
          base: legacyDiff.base,
          branch: legacyDiff.branch,
          status: 'submitted',
          createdAt: legacyDiff.capturedAt,
          submittedAt: legacyFeedback.timestamp,
          artifactDir: globalReviewDir(reviewId),
          feedbackPath: globalReviewFeedbackFile(reviewId),
          markdownPath: globalReviewMarkdownFile(reviewId)
        },
        null,
        2
      )}\n`
    );
    await writeFile(globalReviewDiffFile(reviewId), `${JSON.stringify(legacyDiff, null, 2)}\n`);
    await writeFile(
      globalReviewFeedbackFile(reviewId),
      `${JSON.stringify(legacyFeedback, null, 2)}\n`
    );
    await writeFile(globalReviewMarkdownFile(reviewId), '# legacy feedback\n');

    const store = new ReviewStore();
    const appended = await store.appendTurn(
      reviewId,
      makeStoreDiff({ capturedAt: '2026-05-22T12:05:00.000Z', filePath: 'second.ts' })
    );
    const recovered = await new ReviewStore().get(reviewId);

    expect(appended.record.turns).toHaveLength(2);
    expect(recovered?.turns).toHaveLength(2);
    expect(recovered?.turns[0]?.feedback?.comments[0]?.id).toBe('legacy-comment');
    expect(recovered?.turns[1]?.id).toBe(appended.turn.id);
    expect(recovered?.meta.turns?.map((turn) => turn.comments.total)).toEqual([1, 0]);
  });

  it('recovers canonical artifact paths when turn metadata is stale', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeStoreDiff());
    const submitted = await store.submit(record.meta.id, [makeComment({ id: 'comment-1' })]);
    const { turn } = submitted;
    await writeFile(
      globalReviewTurnMetaFile(record.meta.id, turn.id),
      `${JSON.stringify(
        {
          id: turn.id,
          index: turn.index,
          status: 'pending',
          createdAt: turn.createdAt,
          artifactDir: turn.artifactDir,
          diffPath: turn.diffPath
        },
        null,
        2
      )}\n`
    );

    const recovered = await new ReviewStore().get(record.meta.id);

    expect(recovered?.meta.status).toBe('submitted');
    expect(recovered?.meta.feedbackPath).toBe(
      globalReviewTurnFeedbackFile(record.meta.id, turn.id)
    );
    expect(recovered?.meta.markdownPath).toBe(
      globalReviewTurnMarkdownFile(record.meta.id, turn.id)
    );
    expect(recovered?.feedback?.comments[0]?.id).toBe('comment-1');
  });

  it('recovers a review when root metadata is missing but turn artifacts are valid', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeStoreDiff());
    await rm(globalReviewMetaFile(record.meta.id), { force: true });

    const recovered = await new ReviewStore().get(record.meta.id);

    expect(recovered?.meta.id).toBe(record.meta.id);
    expect(recovered?.meta.activeTurnId).toBe(record.meta.activeTurnId);
    expect(recovered?.meta.status).toBe('pending');
    expect(recovered?.diff.files[0]?.path).toBe(record.diff.files[0]?.path);
    expect(existsSync(globalReviewMetaFile(record.meta.id))).toBe(true);
  });

  it('rejects invalid comment IDs and pending review resolution', async () => {
    const store = new ReviewStore();
    const pending = await store.create(makeStoreDiff());

    await expect(store.markResolved(pending.meta.id, 'too early')).rejects.toThrow(
      /cannot be resolved/
    );
    await expect(store.resolveComment(pending.meta.id, 'comment-1')).rejects.toThrow(
      /cannot be resolved/
    );

    await store.submit(pending.meta.id, [makeComment({ id: 'comment-1' })]);

    await expect(store.resolveComment(pending.meta.id, 'missing-comment')).rejects.toThrow(
      /not found/
    );
    await expect(store.reopenComment(pending.meta.id, 'missing-comment')).rejects.toThrow(
      /not found/
    );
  });

  it('reloads pending reviews from the global store', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeStoreDiff());

    const reloaded = new ReviewStore();
    const loaded = await reloaded.get(record.meta.id);

    expect(loaded?.meta.status).toBe('pending');
    expect(loaded?.diff.cwd).toBe(repoRoot);
    expect(await reloaded.list()).toHaveLength(1);
  });

  it('skips invalid persisted review metadata during list without hiding targeted access', async () => {
    const store = new ReviewStore();
    const record = await store.create(makeStoreDiff());
    const valid = await store.create(makeStoreDiff({ filePath: 'valid.ts' }));
    await writeFile(globalReviewMetaFile(record.meta.id), '{invalid json\n');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const reloaded = new ReviewStore();

    await expect(reloaded.list()).resolves.toEqual([valid.meta]);
    await expect(reloaded.get(record.meta.id)).rejects.toThrow(/Invalid review metadata/);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(`Skipping corrupt review ${record.meta.id}`)
    );
  });
});

function makeStoreDiff(options: { capturedAt?: string; code?: string; filePath?: string } = {}) {
  return makeDiff({ cwd: repoRoot, branch: 'raj--gloss--global-store', ...options });
}

function makeStoreDiffWithCommits() {
  const first = makeStoreDiff();
  const second = makeStoreDiff({
    code: 'export const second = true;',
    filePath: 'second.ts'
  });
  first.commitDiffs = [
    {
      commit: {
        sha: '1234567890abcdef1234567890abcdef12345678',
        shortSha: '1234567',
        subject: 'add api file',
        authorName: 'Gloss Test',
        authorEmail: 'gloss@example.com',
        authoredAt: '2026-05-22T12:00:00.000Z',
        committedAt: '2026-05-22T12:00:01.000Z'
      },
      stats: first.stats,
      rawDiff: first.rawDiff,
      files: first.files
    },
    {
      commit: {
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        shortSha: 'abcdef1',
        subject: 'add second file',
        authorName: 'Gloss Test',
        authorEmail: 'gloss@example.com',
        authoredAt: '2026-05-22T12:01:00.000Z',
        committedAt: '2026-05-22T12:01:01.000Z'
      },
      stats: second.stats,
      rawDiff: second.rawDiff,
      files: second.files
    }
  ];
  return first;
}
