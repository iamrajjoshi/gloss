#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import openBrowser from 'open';
import { clearReviewArtifacts, DEFAULT_REVIEW_RETENTION_DAYS } from '../shared/cleanup';
import { formatError, isFileNotFound } from '../shared/errors';
import { ensureDir, globalServerFile, globalStateDir, packageVersion } from '../shared/paths';
import { serverInfoPermissionMessage } from '../shared/server-info';
import type {
  ClearReviewsResult,
  DiffPayload,
  FeedbackBundle,
  ResolveResult,
  ReviewEvent,
  ReviewMeta,
  ServerInfo
} from '../shared/types';
import { assertGitAvailable, captureDiff, getRepoRoot } from './git';
import {
  ensureServer,
  isServerResponsive,
  listGlossDaemonPids,
  readServerInfo,
  type StopServerResult,
  serverUrl,
  startServer,
  stopServer
} from './lifecycle';
import { ServerClient } from './server-client';
import { listReviewsForStatus } from './status';

interface GlobalOptions {
  json?: boolean;
  noColor?: boolean;
}

type DoctorCheck = { name: string; ok: boolean; detail?: string };

type CliJsonOutput =
  | ServerInfo
  | ReviewEvent
  | ResolveResult
  | StopServerResult
  | ClearReviewsResult
  | {
      reviewId: string;
      turnId?: string;
      turnIndex?: number;
      url: string;
      files: number;
      scope: DiffPayload['scope']['mode'];
      artifactDir: string;
      reused?: boolean;
    }
  | {
      reviewId: string;
      turnId?: string;
      turnIndex?: number;
      url: string;
      files: number;
      comments: number;
      feedbackPath: string;
      markdownPath: string;
      artifactDir: string;
      feedback: FeedbackBundle;
      reused?: boolean;
    }
  | { running: boolean; server: ServerInfo | null; reviews: ReviewMeta[] }
  | (ResolveResult & { commentId: string | null; summary: string | null })
  | (ResolveResult & { commentId: string | null; summary: string | null; turn: string | null })
  | { checks: DoctorCheck[] };

function printJson(value: CliJsonOutput): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printPlain(value: string): void {
  process.stdout.write(`${value}\n`);
}

const program = new Command();

program
  .name('gloss')
  .description('Local browser-based diff review for coding-agent loops.')
  .version(packageVersion)
  .option('--json', 'print JSON for supported commands')
  .option('--no-color', 'disable color output');

program
  .command('open')
  .description('Capture local changes and open them for review')
  .option('--base <ref>', 'explicit base git ref')
  .option('--review <reviewId>', 'append or resume a turn in an existing review')
  .option('--print-url', 'print review URL')
  .option('--no-open', 'do not open a browser')
  .option('--no-watch', 'return immediately after registering the review')
  .option('--timeout <seconds>', 'watch timeout in seconds', Number)
  .action(
    async (options: {
      base?: string;
      printUrl?: boolean;
      open?: boolean;
      review?: string;
      watch?: boolean;
      timeout?: number;
    }) => {
      const globals = program.opts<GlobalOptions>();
      let info = await ensureServer();
      let client = new ServerClient(serverUrl(info));
      const inheritedBase =
        options.review && !options.base
          ? await baseForExistingReview(client, options.review)
          : null;
      const diff = await captureDiff(options.base ?? inheritedBase ?? undefined);
      const created = options.review
        ? await client.appendReviewTurn(options.review, diff)
        : await client.createReview(diff);
      const meta = created.meta;
      const turn = created.turn ?? meta.turns?.find((summary) => summary.id === meta.activeTurnId);
      if (!turn) {
        throw new Error(`Review ${meta.id} has no active turn`);
      }
      const reused = 'reused' in created ? created.reused === true : false;
      let url = created.url;
      const shouldWatch = options.watch !== false;

      if (options.printUrl) {
        printPlain(url);
      }
      if (options.open !== false) {
        await openBrowser(url);
      }

      if (!shouldWatch) {
        const result = {
          reviewId: meta.id,
          turnId: turn.id,
          turnIndex: turn.index,
          url,
          files: diff.files.length,
          scope: diff.scope.mode,
          artifactDir: turn.artifactDir,
          reused
        };
        globals.json ? printJson(result) : printPlain(`Review ${meta.id}: ${url}`);
        return;
      }

      const watched = await watchReviewWithReconnect(
        meta.id,
        info,
        options.timeout,
        async (nextInfo) => {
          info = nextInfo;
          client = new ServerClient(serverUrl(info));
          url = `${serverUrl(info)}/review/${meta.id}`;
          if (options.printUrl) {
            printPlain(url);
          }
          if (options.open !== false) {
            await openBrowser(url);
          }
        }
      );
      info = watched.info;
      client = new ServerClient(serverUrl(info));
      const event = watched.event;
      if (event.type === 'review.cancelled') {
        process.exitCode = 2;
        globals.json ? printJson(event) : printPlain(`Review ${meta.id} cancelled`);
        return;
      }
      if (event.type !== 'review.submitted') {
        throw new Error(`Unexpected review event ${event.type}`);
      }

      const [feedback, submittedRecord] = await Promise.all([
        client.getFeedback(meta.id),
        client.getReview(meta.id)
      ]);
      const submittedTurn =
        submittedRecord.meta.turns?.find((summary) => summary.id === (event.turnId ?? turn.id)) ??
        turn;
      if (!submittedTurn.feedbackPath || !submittedTurn.markdownPath) {
        throw new Error(`Review ${meta.id} turn ${submittedTurn.index} is missing feedback paths`);
      }
      const result = {
        reviewId: meta.id,
        turnId: submittedTurn.id,
        turnIndex: submittedTurn.index,
        url,
        files: event.counts.files,
        comments: event.counts.comments,
        feedbackPath: submittedTurn.feedbackPath,
        markdownPath: submittedTurn.markdownPath,
        artifactDir: submittedTurn.artifactDir,
        feedback,
        reused
      };
      globals.json
        ? printJson(result)
        : printPlain(`Review ${meta.id} submitted with ${event.counts.comments} comments`);
    }
  );

program
  .command('watch')
  .argument('<reviewId>', 'review id')
  .description('Wait for review.submitted for an existing review')
  .option('--timeout <seconds>', 'watch timeout in seconds', Number)
  .action(async (reviewId: string, options: { timeout?: number }) => {
    const globals = program.opts<GlobalOptions>();
    const info = await ensureServer();
    const { event } = await watchReviewWithReconnect(
      reviewId,
      info,
      options.timeout,
      async () => undefined
    );
    globals.json ? printJson(event) : printPlain(`${event.type} ${event.reviewId}`);
  });

program
  .command('start')
  .description('Start or reuse the background server')
  .option('--port <port>', 'port to bind', Number)
  .action(async (options: { port?: number }) => {
    const globals = program.opts<GlobalOptions>();
    const info = await startServer({ port: options.port });
    globals.json
      ? printJson(info)
      : printPlain(`Gloss server running at ${serverUrl(info)} (pid ${info.pid})`);
  });

program
  .command('status')
  .description('Show server and active reviews')
  .action(async () => {
    const globals = program.opts<GlobalOptions>();
    const info = await readServerInfo();
    const responsive = info ? await isServerResponsive(info) : false;
    const reviews = await listReviewsForStatus({ responsive, server: info });
    const status = { running: responsive, server: info, reviews };
    globals.json
      ? printJson(status)
      : printPlain(
          responsive && info
            ? `Gloss server running at ${serverUrl(info)} with ${reviews.length} active review(s)`
            : 'Gloss server is not running'
        );
  });

program
  .command('stop')
  .description('Stop the managed background server')
  .option('--all', 'stop all Gloss daemon processes for the current user')
  .action(async (options: { all?: boolean }) => {
    const globals = program.opts<GlobalOptions>();
    const result = await stopServer({ all: options.all });
    globals.json ? printJson(result) : printPlain(formatStopResult(result, options.all === true));
  });

program
  .command('clear')
  .description('Delete old completed review artifacts')
  .option(
    '--older-than <days>',
    'delete completed reviews older than this many days',
    parseOlderThanDays,
    DEFAULT_REVIEW_RETENTION_DAYS
  )
  .option('--dry-run', 'print cleanup candidates without deleting them')
  .action(async (options: { olderThan: number; dryRun?: boolean }) => {
    const globals = program.opts<GlobalOptions>();
    const result = await clearReviews({
      olderThanDays: options.olderThan,
      dryRun: options.dryRun === true
    });
    globals.json ? printJson(result) : printPlain(formatClearResult(result));
  });

program
  .command('resolve')
  .argument('<reviewId>', 'review id')
  .description('Mark a submitted review or one feedback comment as resolved')
  .option('--comment <commentId>', 'resolve one submitted feedback comment')
  .option('--summary <text>', 'brief summary of the fixes applied')
  .option('--turn <idOrIndex>', 'resolve a specific turn for whole-review resolution')
  .action(
    async (reviewId: string, options: { comment?: string; summary?: string; turn?: string }) => {
      const globals = program.opts<GlobalOptions>();
      const info = await ensureServer();
      const client = new ServerClient(serverUrl(info));
      const result = options.comment
        ? await client.resolveComment(reviewId, options.comment, options.summary)
        : await client.markResolved(reviewId, options.summary, options.turn);
      if (globals.json) {
        printJson({
          commentId: options.comment ?? null,
          summary: options.summary ?? null,
          turn: options.turn ?? null,
          ...result
        });
        return;
      }
      printPlain(
        options.comment
          ? `Comment ${options.comment} resolved in review ${reviewId}`
          : `Review ${reviewId} resolved`
      );
    }
  );

program
  .command('doctor')
  .description('Diagnose setup and validate git/state')
  .action(async () => {
    const globals = program.opts<GlobalOptions>();
    const checks: DoctorCheck[] = [];
    try {
      await assertGitAvailable();
      checks.push({ name: 'git', ok: true });
    } catch (error) {
      checks.push({
        name: 'git',
        ok: false,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
    try {
      const root = await getRepoRoot();
      checks.push({ name: 'repo', ok: true, detail: root });
    } catch (error) {
      checks.push({
        name: 'repo',
        ok: false,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
    checks.push(await checkStateDirAccess());
    checks.push(await checkServerInfoAccess());
    let info: ServerInfo | null = null;
    let serverStateError: unknown = null;
    try {
      info = await readServerInfo();
    } catch (error) {
      serverStateError = error;
    }
    checks.push({
      name: 'server',
      ok: info ? await isServerResponsive(info) : false,
      detail: info
        ? serverUrl(info)
        : serverStateError
          ? formatError(serverStateError)
          : 'not started'
    });
    try {
      const daemonPids = await listGlossDaemonPids();
      const unmanagedDaemonPids = daemonPids.filter((pid) => pid !== info?.pid);
      checks.push({
        name: 'daemon-processes',
        ok: unmanagedDaemonPids.length === 0,
        detail:
          daemonPids.length === 0
            ? 'none'
            : `${daemonPids.length} found${unmanagedDaemonPids.length > 0 ? `; unmanaged pids ${unmanagedDaemonPids.join(', ')}` : ''}`
      });
    } catch (error) {
      checks.push({
        name: 'daemon-processes',
        ok: false,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
    if (globals.json) {
      printJson({ checks });
    } else {
      for (const check of checks) {
        printPlain(
          `${check.ok ? 'ok' : 'fail'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`
        );
      }
    }
  });

async function watchReviewWithReconnect(
  reviewId: string,
  initialInfo: ServerInfo,
  timeoutSeconds: number | undefined,
  onServerChanged: (info: ServerInfo) => Promise<void>
): Promise<{ event: ReviewEvent; info: ServerInfo }> {
  const startedAt = Date.now();
  let info = initialInfo;

  while (true) {
    const remainingSeconds =
      timeoutSeconds && timeoutSeconds > 0
        ? timeoutSeconds - (Date.now() - startedAt) / 1000
        : undefined;
    if (remainingSeconds !== undefined && remainingSeconds <= 0) {
      throw new Error(`watch timed out after ${timeoutSeconds} seconds`);
    }

    try {
      const event = await new ServerClient(serverUrl(info)).watchReview(reviewId, remainingSeconds);
      return { event, info };
    } catch (error) {
      if (isWatchTimeout(error)) {
        throw error;
      }
      if (!isReconnectableWatchError(error)) {
        throw error;
      }
      await sleep(500);
      const nextInfo = await ensureServer();
      if (nextInfo.port !== info.port) {
        await onServerChanged(nextInfo);
      }
      info = nextInfo;
    }
  }
}

function formatStopResult(result: StopServerResult, all: boolean): string {
  const status =
    all && result.stoppedPids
      ? `Stopped ${result.stoppedPids.length} Gloss daemon(s)`
      : result.stopped
        ? 'Gloss server stopped'
        : 'Gloss server was not running';
  return result.warning ? `${status}\nWarning: ${result.warning}` : status;
}

async function checkStateDirAccess(): Promise<DoctorCheck> {
  const probePath = path.join(globalStateDir(), `.doctor-${process.pid}-${randomUUID()}.tmp`);
  try {
    await ensureDir(globalStateDir());
    await access(globalStateDir(), constants.R_OK | constants.W_OK | constants.X_OK);
    await writeFile(probePath, '');
    await rm(probePath, { force: true });
    return { name: 'state-dir', ok: true, detail: stateDirDetail() };
  } catch (error) {
    await rm(probePath, { force: true }).catch(() => undefined);
    return {
      name: 'state-dir',
      ok: false,
      detail: `${stateDirDetail()}: ${formatError(error)}. Set GLOSS_STATE_DIR to a writable directory for sandboxed agents.`
    };
  }
}

async function checkServerInfoAccess(): Promise<DoctorCheck> {
  try {
    await access(globalServerFile(), constants.R_OK | constants.W_OK);
    return { name: 'server-json', ok: true, detail: globalServerFile() };
  } catch (error) {
    if (isFileNotFound(error)) {
      return { name: 'server-json', ok: true, detail: 'not present' };
    }
    return {
      name: 'server-json',
      ok: false,
      detail: serverInfoPermissionMessage('access', error)
    };
  }
}

function stateDirDetail(): string {
  return process.env.GLOSS_STATE_DIR
    ? `${globalStateDir()} (from GLOSS_STATE_DIR)`
    : `${globalStateDir()} (default; set GLOSS_STATE_DIR for a writable sandbox state dir)`;
}

async function baseForExistingReview(
  client: ServerClient,
  reviewId: string
): Promise<string | null> {
  const record = await client.getReview(reviewId);
  return record.diff.scope.mode === 'explicit'
    ? (record.diff.scope.requestedBase ?? record.diff.base.ref)
    : null;
}

async function clearReviews(options: {
  olderThanDays: number;
  dryRun: boolean;
}): Promise<ClearReviewsResult> {
  const info = await readServerInfo();
  if (info && (await isServerResponsive(info))) {
    return new ServerClient(serverUrl(info)).clearReviews(options);
  }
  return clearReviewArtifacts(options);
}

function parseOlderThanDays(value: string): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0) {
    throw new Error('--older-than must be a non-negative integer');
  }
  return days;
}

function formatClearResult(result: ClearReviewsResult): string {
  const action = result.dryRun ? 'Would delete' : 'Deleted';
  const count = result.dryRun ? result.counts.candidates : result.counts.deleted;
  const skipped =
    result.counts.skipped > 0
      ? `; skipped ${result.counts.skipped} invalid review artifact(s)`
      : '';
  return `${action} ${count} review artifact(s) older than ${result.olderThanDays} day(s) from ${result.reviewsDir}${skipped}`;
}

function isWatchTimeout(error: unknown): error is Error {
  return error instanceof Error && /^watch timed out after/.test(error.message);
}

function isReconnectableWatchError(error: unknown): error is Error {
  return error instanceof Error && !/^watch failed: [45]\d\d /.test(error.message);
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
