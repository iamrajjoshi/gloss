import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { globalStateDir, packageVersion, protocolVersion } from '../shared/paths';
import { readServerInfo, removeServerInfoFile, writeServerInfo } from '../shared/server-info';
import { createIdleScheduler, normalizeIdleTimeoutMs } from './idle';
import { createApp } from './index';
import { runStartupCleanup } from './maintenance';

const port = Number(process.env.GLOSS_PORT ?? '0');
const idleTimeoutMs = normalizeIdleTimeoutMs();
const daemonPath = fileURLToPath(import.meta.url);

if (!port) {
  throw new Error('GLOSS_PORT is required');
}

const origin = `http://localhost:${port}`;
const eventStreams = new Set<() => void>();
let shuttingDown = false;
const idleScheduler = createIdleScheduler({
  timeoutMs: idleTimeoutMs,
  hasLiveClients: () => eventStreams.size > 0,
  isShuttingDown: () => shuttingDown,
  shutdown: () => shutdown(0)
});

const server = serve({
  fetch: createApp(origin, {
    onReviewActivity: () => {
      idleScheduler.schedule();
    },
    registerEventStream: (close) => {
      eventStreams.add(close);
      idleScheduler.schedule();
      return () => {
        eventStreams.delete(close);
        idleScheduler.schedule();
      };
    },
    health: () => {
      return {
        connections: eventStreams.size,
        cwd: process.cwd(),
        daemonPath,
        stateDir: globalStateDir()
      };
    }
  }).fetch,
  port
});

await writeServerInfo({
  pid: process.pid,
  port,
  version: packageVersion,
  protocolVersion,
  startedAt: new Date().toISOString(),
  stateDir: globalStateDir(),
  cwd: process.cwd(),
  daemonPath
});

await runStartupCleanup();
idleScheduler.schedule();

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  idleScheduler.cancel();
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
