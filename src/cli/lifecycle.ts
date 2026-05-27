import { spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import getPort from 'get-port';
import {
  ensureDir,
  globalLogDir,
  globalServerFile,
  globalServerLogFile,
  globalStateDir,
  packageVersion
} from '../shared/paths';
import { readServerInfo, writeServerInfo } from '../shared/server-info';
import type { ServerInfo } from '../shared/types';
import { ServerClient } from './server-client';

export { readServerInfo } from '../shared/server-info';

export function serverUrl(info: Pick<ServerInfo, 'port'>): string {
  return `http://localhost:${info.port}`;
}

export async function isServerResponsive(info: ServerInfo): Promise<boolean> {
  if (!isPidAlive(info.pid)) {
    return false;
  }
  try {
    const health = await new ServerClient(serverUrl(info)).health();
    return health.ok === true && health.version === packageVersion;
  } catch {
    return false;
  }
}

export async function ensureServer(options: { port?: number } = {}): Promise<ServerInfo> {
  const existing = await readServerInfo();
  if (existing && (await isServerResponsive(existing))) {
    return existing;
  }
  return startServer(options);
}

export async function startServer(options: { port?: number } = {}): Promise<ServerInfo> {
  const existing = await readServerInfo();
  if (existing && (await isServerResponsive(existing))) {
    return existing;
  }

  await ensureDir(globalStateDir());
  await ensureDir(globalLogDir());
  const port = options.port ?? (await getPort());
  const daemonPath = fileURLToPath(new URL('../server/daemon.js', import.meta.url));
  if (!existsSync(daemonPath)) {
    throw new Error(`Cannot find server daemon at ${daemonPath}. Run pnpm build first.`);
  }

  const logFd = openSync(globalServerLogFile(), 'a');
  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    env: {
      ...process.env,
      GLOSS_PORT: String(port),
      GLOSS_STATE_DIR: globalStateDir()
    },
    stdio: ['ignore', logFd, logFd]
  });
  child.unref();

  const info: ServerInfo = {
    pid: child.pid ?? -1,
    port,
    version: packageVersion,
    startedAt: new Date().toISOString(),
    stateDir: globalStateDir()
  };
  await writeServerInfo(info);

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await isServerResponsive(info)) {
      return info;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Server did not become responsive. See ${globalServerLogFile()}`);
}

export async function stopServer(): Promise<{ stopped: boolean; info: ServerInfo | null }> {
  const info = await readServerInfo();
  if (!info) {
    return { stopped: false, info: null };
  }

  if (isPidAlive(info.pid)) {
    process.kill(info.pid, 'SIGTERM');
  }
  await rm(globalServerFile(), { force: true });
  return { stopped: true, info };
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
