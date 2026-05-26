#!/usr/bin/env node
import { Command } from 'commander';
import openBrowser from 'open';
import {
  globalReviewDir,
  globalReviewFeedbackFile,
  globalReviewMarkdownFile,
  packageVersion
} from '../shared/paths';
import { assertGitAvailable, captureDiff, getRepoRoot } from './git';
import {
  ensureServer,
  isServerResponsive,
  readServerInfo,
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

function printJson(value: unknown): void {
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
  .option('--print-url', 'print review URL')
  .option('--no-open', 'do not open a browser')
  .option('--no-watch', 'return immediately after registering the review')
  .option('--timeout <seconds>', 'watch timeout in seconds', Number)
  .action(
    async (options: {
      base?: string;
      printUrl?: boolean;
      open?: boolean;
      watch?: boolean;
      timeout?: number;
    }) => {
      const globals = program.opts<GlobalOptions>();
      const info = await ensureServer();
      const client = new ServerClient(serverUrl(info));
      const diff = await captureDiff(options.base);
      const { meta, url } = await client.createReview(diff);

      if (options.printUrl) {
        printPlain(url);
      }
      if (options.open !== false) {
        await openBrowser(url);
      }

      if (options.watch === false) {
        const result = {
          reviewId: meta.id,
          url,
          files: diff.files.length,
          scope: diff.scope.mode,
          artifactDir: meta.artifactDir
        };
        globals.json ? printJson(result) : printPlain(`Review ${meta.id}: ${url}`);
        return;
      }

      const event = await client.watchReview(meta.id, options.timeout);
      if (event.type === 'review.cancelled') {
        process.exitCode = 2;
        globals.json ? printJson(event) : printPlain(`Review ${meta.id} cancelled`);
        return;
      }
      if (event.type !== 'review.submitted') {
        throw new Error(`Unexpected review event ${event.type}`);
      }

      const feedback = await client.getFeedback(meta.id);
      const result = {
        reviewId: meta.id,
        url,
        files: event.counts.files,
        comments: event.counts.comments,
        feedbackPath: globalReviewFeedbackFile(meta.id),
        markdownPath: globalReviewMarkdownFile(meta.id),
        artifactDir: globalReviewDir(meta.id),
        feedback
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
    const client = new ServerClient(serverUrl(info));
    const event = await client.watchReview(reviewId, options.timeout);
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
  .option('--all', 'reserved for future multi-server cleanup')
  .action(async () => {
    const globals = program.opts<GlobalOptions>();
    const result = await stopServer();
    globals.json
      ? printJson(result)
      : printPlain(result.stopped ? 'Gloss server stopped' : 'Gloss server was not running');
  });

program
  .command('resolve')
  .argument('<reviewId>', 'review id')
  .description('Mark a submitted review or one feedback comment as resolved')
  .option('--comment <commentId>', 'resolve one submitted feedback comment')
  .option('--summary <text>', 'brief summary of the fixes applied')
  .action(async (reviewId: string, options: { comment?: string; summary?: string }) => {
    const globals = program.opts<GlobalOptions>();
    const info = await ensureServer();
    const client = new ServerClient(serverUrl(info));
    const result = options.comment
      ? await client.resolveComment(reviewId, options.comment, options.summary)
      : await client.markResolved(reviewId, options.summary);
    if (globals.json) {
      printJson({
        commentId: options.comment ?? null,
        summary: options.summary ?? null,
        ...result
      });
      return;
    }
    printPlain(
      options.comment
        ? `Comment ${options.comment} resolved in review ${reviewId}`
        : `Review ${reviewId} resolved`
    );
  });

program
  .command('doctor')
  .description('Diagnose setup and validate git/state')
  .action(async () => {
    const globals = program.opts<GlobalOptions>();
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
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
    const info = await readServerInfo();
    checks.push({
      name: 'server',
      ok: info ? await isServerResponsive(info) : false,
      detail: info ? serverUrl(info) : 'not started'
    });
    checks.push({
      name: '@pierre/diffs license',
      ok: true,
      detail: 'apache-2.0 dependency present'
    });

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

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
