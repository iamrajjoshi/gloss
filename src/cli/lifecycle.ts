import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);
const gracefulShutdownTimeoutMs = 2000;
const forceShutdownTimeoutMs = 1000;

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
  if (existing) {
    await retireServer(existing);
  }

  const preferredPort = options.port ?? existing?.port ?? (await getPort());
  try {
    return await launchServer(preferredPort);
  } catch (error) {
    if (options.port || !existing?.port) {
      throw error;
    }
    await removeServerInfoForPid(existing.pid);
    return launchServer(await getPort());
  }
}

async function launchServer(port: number): Promise<ServerInfo> {
  await ensureDir(globalStateDir());
  await ensureDir(globalLogDir());
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
  closeSync(logFd);
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

  await terminatePid(info.pid);
  await removeServerInfoForPid(info.pid);
  throw new Error(`Server did not become responsive. See ${globalServerLogFile()}`);
}

export async function stopServer(
  options: { all?: boolean } = {}
): Promise<{ stopped: boolean; info: ServerInfo | null; stoppedPids?: number[] }> {
  if (options.all) {
    const info = await readServerInfo();
    const daemonPids = await listGlossDaemonPids();
    const stoppedPids: number[] = [];
    for (const pid of daemonPids) {
      if (await terminatePid(pid)) {
        stoppedPids.push(pid);
      }
    }
    await rm(globalServerFile(), { force: true });
    return { stopped: stoppedPids.length > 0, info, stoppedPids };
  }

  const info = await readServerInfo();
  if (!info) {
    return { stopped: false, info: null };
  }

  if (!isPidAlive(info.pid)) {
    await removeServerInfoForPid(info.pid);
    return { stopped: false, info };
  }

  if (!(await isGlossDaemonPid(info.pid))) {
    await removeServerInfoForPid(info.pid);
    return { stopped: false, info };
  }

  const stopped = await terminatePid(info.pid);
  if (stopped) {
    await removeServerInfoForPid(info.pid);
  }
  return { stopped, info };
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

async function retireServer(info: ServerInfo): Promise<void> {
  if (isPidAlive(info.pid) && (await isGlossDaemonPid(info.pid))) {
    await terminatePid(info.pid);
  }
  await removeServerInfoForPid(info.pid);
}

async function terminatePid(pid: number): Promise<boolean> {
  if (!isPidAlive(pid)) {
    return true;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return !isPidAlive(pid);
  }
  if (await waitForPidExit(pid, gracefulShutdownTimeoutMs)) {
    return true;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return !isPidAlive(pid);
  }
  return waitForPidExit(pid, forceShutdownTimeoutMs);
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isPidAlive(pid);
}

async function removeServerInfoForPid(pid: number): Promise<void> {
  const current = await readServerInfo().catch(() => null);
  if (!current || current.pid === pid) {
    await rm(globalServerFile(), { force: true });
  }
}

async function isGlossDaemonPid(pid: number): Promise<boolean> {
  const command = await readProcessCommand(pid);
  return command ? isGlossDaemonCommand(command) : false;
}

async function readProcessCommand(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid), '-ww']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function listGlossDaemonPids(): Promise<number[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('ps', ['-axo', 'pid=,user=,command=', '-ww']));
  } catch {
    return [];
  }
  const currentUser = userInfo().username;
  return parseGlossDaemonPids(stdout, currentUser, process.pid);
}

export function parseGlossDaemonPids(
  stdout: string,
  currentUser: string,
  currentPid = process.pid
): number[] {
  return stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({
      pid: Number(match[1]),
      user: match[2],
      command: match[3]
    }))
    .filter(
      ({ pid, user, command }) =>
        pid !== currentPid && user === currentUser && isGlossDaemonCommand(command)
    )
    .map(({ pid }) => pid);
}

function isGlossDaemonCommand(command: string): boolean {
  return /(?:^|\s)(?:\S*\/)?node\s+\S*dist\/server\/daemon\.js(?:\s|$)/.test(command);
}
