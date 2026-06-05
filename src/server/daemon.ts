import { serve } from '@hono/node-server';
import { globalStateDir, packageVersion } from '../shared/paths';
import { readServerInfo, removeServerInfoFile, writeServerInfo } from '../shared/server-info';
import { createApp } from './index';
import { runStartupCleanup } from './maintenance';
import { reviewStore } from './store';

const port = Number(process.env.GLOSS_PORT ?? '0');
const idleTimeoutMs = Number(process.env.GLOSS_IDLE_TIMEOUT_MS ?? '120000');

if (!port) {
  throw new Error('GLOSS_PORT is required');
}

const origin = `http://localhost:${port}`;
const eventStreams = new Set<() => void>();
let idleTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

const server = serve({
  fetch: createApp(origin, {
    onReviewActivity: () => {
      void scheduleIdleShutdown();
    },
    registerEventStream: (close) => {
      eventStreams.add(close);
      return () => {
        eventStreams.delete(close);
      };
    }
  }).fetch,
  port
});

await writeServerInfo({
  pid: process.pid,
  port,
  version: packageVersion,
  startedAt: new Date().toISOString(),
  stateDir: globalStateDir()
});

await runStartupCleanup();
await scheduleIdleShutdown();

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

async function scheduleIdleShutdown(): Promise<void> {
  if (shuttingDown || idleTimeoutMs <= 0) {
    return;
  }

  const activeReviews = await countActiveReviews();
  if (activeReviews > 0) {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    return;
  }

  if (!idleTimer) {
    idleTimer = setTimeout(() => {
      idleTimer = null;
      void shutdownIfIdle();
    }, idleTimeoutMs);
  }
}

async function shutdownIfIdle(): Promise<void> {
  if ((await countActiveReviews()) > 0) {
    await scheduleIdleShutdown();
    return;
  }
  await shutdown(0);
}

async function countActiveReviews(): Promise<number> {
  const reviews = await reviewStore.list();
  return reviews.filter((review) => review.status === 'pending').length;
}

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  for (const close of [...eventStreams]) {
    close();
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await removeCurrentServerInfo();
  process.exit(exitCode);
}

async function removeCurrentServerInfo(): Promise<void> {
  const info = await readServerInfo().catch(() => null);
  if (!info || info.pid === process.pid) {
    const warning = await removeServerInfoFile();
    if (warning) {
      process.stderr.write(`Warning: ${warning}\n`);
    }
  }
}
