import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import getPort from 'get-port';
import {
  ensureDir,
  globalLogDir,
  globalServerLockDir,
  globalServerLogFile,
  globalStateDir,
  packageVersion
} from '../shared/paths';
import { readServerInfo, removeServerInfoFile, writeServerInfo } from '../shared/server-info';
import type { ServerInfo } from '../shared/types';
import { ServerClient } from './server-client';

export { readServerInfo } from '../shared/server-info';

export interface StopServerResult {
  stopped: boolean;
  info: ServerInfo | null;
  stoppedPids?: number[];
  warning?: string;
}

export interface GlossDaemonProcess {
  pid: number;
  user: string;
  command: string;
  daemonPath: string;
  homebrewVersion?: string;
}

const execFileAsync = promisify(execFile);
const gracefulShutdownTimeoutMs = 2000;
const forceShutdownTimeoutMs = 1000;
const serverLockTimeoutMs = 8000;
const staleServerLockMs = 30000;

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
  return withServerLock(async () => {
    const existing = await readServerInfo();
    await reapStaleDaemons(existing);
    if (existing && (await isServerResponsive(existing))) {
      return existing;
    }
    return startServerUnlocked(existing, options);
  });
}

export async function startServer(options: { port?: number } = {}): Promise<ServerInfo> {
  return withServerLock(async () => {
    const existing = await readServerInfo();
    await reapStaleDaemons(existing);
    if (existing && (await isServerResponsive(existing))) {
      return existing;
    }
    return startServerUnlocked(existing, options);
  });
}

async function startServerUnlocked(
  existing: ServerInfo | null,
  options: { port?: number } = {}
): Promise<ServerInfo> {
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
    stateDir: globalStateDir(),
    cwd: process.cwd(),
    daemonPath
  };
  try {
    await writeServerInfo(info);
  } catch (error) {
    await terminatePid(info.pid);
    throw error;
  }

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

async function withServerLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireServerLock();
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function acquireServerLock(): Promise<() => Promise<void>> {
  await ensureDir(globalStateDir());
  const lockDir = globalServerLockDir();
  const ownerFile = serverLockOwnerFile();
  const deadline = Date.now() + serverLockTimeoutMs;

  while (true) {
    try {
      await mkdir(lockDir);
      try {
        await writeFile(
          ownerFile,
          `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`
        );
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return () => rm(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      if (await removeStaleServerLock(lockDir, ownerFile)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Gloss server lock at ${lockDir}`);
      }
      await sleep(50);
    }
  }
}

async function removeStaleServerLock(lockDir: string, ownerFile: string): Promise<boolean> {
  const owner = await readServerLockOwner(ownerFile);
  if (owner?.pid && !isPidAlive(owner.pid)) {
    await rm(lockDir, { recursive: true, force: true });
    return true;
  }

  if (!owner && (await isOldLockDir(lockDir))) {
    await rm(lockDir, { recursive: true, force: true });
    return true;
  }

  return false;
}

async function readServerLockOwner(ownerFile: string): Promise<{ pid: number } | null> {
  try {
    const raw = await readFile(ownerFile, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === 'number' && Number.isFinite(parsed.pid)
      ? { pid: parsed.pid }
      : null;
  } catch {
    return null;
  }
}

async function isOldLockDir(lockDir: string): Promise<boolean> {
  try {
    const info = await stat(lockDir);
    return Date.now() - info.mtimeMs > staleServerLockMs;
  } catch {
    return false;
  }
}

function serverLockOwnerFile(): string {
  return path.join(globalServerLockDir(), 'owner.json');
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

export async function stopServer(options: { all?: boolean } = {}): Promise<StopServerResult> {
  if (options.all) {
    const { info, warning: readWarning } = await readServerInfoForStop();
    const daemonPids = (await listGlossDaemonProcesses()).map((processInfo) => processInfo.pid);
    const stoppedPids: number[] = [];
    for (const pid of daemonPids) {
      if (await terminatePid(pid)) {
        stoppedPids.push(pid);
      }
    }
    return withWarning(
      { stopped: stoppedPids.length > 0, info, stoppedPids },
      combineWarnings(readWarning, await removeServerInfoFile())
    );
  }

  const { info, warning: readWarning } = await readServerInfoForStop();
  if (!info) {
    return withWarning({ stopped: false, info: null }, readWarning);
  }

  if (!isPidAlive(info.pid)) {
    return withWarning({ stopped: false, info }, await removeServerInfoForPid(info.pid));
  }

  if (!(await isGlossDaemonPid(info.pid))) {
    return withWarning({ stopped: false, info }, await removeServerInfoForPid(info.pid));
  }

  const stopped = await terminatePid(info.pid);
  let warning: string | null = null;
  if (stopped) {
    warning = await removeServerInfoForPid(info.pid);
  }
  return withWarning({ stopped, info }, warning);
}

export async function reapStaleDaemons(managed: ServerInfo | null): Promise<number[]> {
  if (process.env.GLOSS_SKIP_STALE_DAEMON_REAP === '1') {
    return [];
  }

  const processes = await listGlossDaemonProcesses();
  const managedProcess = managed
    ? processes.find((processInfo) => processInfo.pid === managed.pid)
    : null;
  const managedSource = managedProcess
    ? daemonSourceKey(managedProcess)
    : managed?.daemonPath
      ? daemonPathSourceKey(managed.daemonPath)
      : null;
  const reapedPids: number[] = [];

  for (const processInfo of processes) {
    const shouldReap =
      isMissingDaemonSource(processInfo) ||
      isStaleHomebrewDaemon(processInfo) ||
      (managedSource !== null &&
        processInfo.pid !== managed?.pid &&
        daemonSourceKey(processInfo) === managedSource);
    if (!shouldReap) {
      continue;
    }
    if (await terminatePid(processInfo.pid)) {
      reapedPids.push(processInfo.pid);
      if (processInfo.pid === managed?.pid) {
        await removeServerInfoForPid(processInfo.pid);
      }
    }
  }

  return reapedPids;
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
    await sleep(50);
  }
  return !isPidAlive(pid);
}

async function removeServerInfoForPid(pid: number): Promise<string | null> {
  const current = await readServerInfo().catch(() => null);
  if (!current || current.pid === pid) {
    return removeServerInfoFile();
  }
  return null;
}

function withWarning<T extends StopServerResult>(result: T, warning: string | null): T {
  return warning ? { ...result, warning } : result;
}

async function readServerInfoForStop(): Promise<{
  info: ServerInfo | null;
  warning: string | null;
}> {
  try {
    return { info: await readServerInfo(), warning: null };
  } catch (error) {
    return { info: null, warning: error instanceof Error ? error.message : String(error) };
  }
}

function combineWarnings(...warnings: Array<string | null>): string | null {
  const present = warnings.filter((warning): warning is string => Boolean(warning));
  return present.length > 0 ? present.join(' ') : null;
}

async function isGlossDaemonPid(pid: number): Promise<boolean> {
  const command = await readProcessCommand(pid);
  return command ? parseGlossDaemonCommand(command) !== null : false;
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
  return (await listGlossDaemonProcesses()).map((processInfo) => processInfo.pid);
}

async function listGlossDaemonProcesses(): Promise<GlossDaemonProcess[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('ps', ['-axo', 'pid=,user=,command=', '-ww']));
  } catch {
    return [];
  }
  const currentUser = userInfo().username;
  return parseGlossDaemonProcesses(stdout, currentUser, process.pid);
}

export function parseGlossDaemonPids(
  stdout: string,
  currentUser: string,
  currentPid = process.pid
): number[] {
  return parseGlossDaemonProcesses(stdout, currentUser, currentPid).map(
    (processInfo) => processInfo.pid
  );
}

export function parseGlossDaemonProcesses(
  stdout: string,
  currentUser: string,
  currentPid = process.pid
): GlossDaemonProcess[] {
  return stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({
      pid: Number(match[1]),
      user: match[2],
      command: match[3]
    }))
    .map((processInfo) => ({
      ...processInfo,
      parsed: parseGlossDaemonCommand(processInfo.command)
    }))
    .filter(
      (
        processInfo
      ): processInfo is {
        pid: number;
        user: string;
        command: string;
        parsed: { daemonPath: string; homebrewVersion?: string };
      } =>
        processInfo.pid !== currentPid &&
        processInfo.user === currentUser &&
        processInfo.parsed !== null
    )
    .map(({ pid, user, command, parsed }) => ({
      pid,
      user,
      command,
      daemonPath: parsed.daemonPath,
      ...(parsed.homebrewVersion ? { homebrewVersion: parsed.homebrewVersion } : {})
    }));
}

function parseGlossDaemonCommand(
  command: string
): { daemonPath: string; homebrewVersion?: string } | null {
  const match = /(?:^|\s)(?:\S*\/)?node\s+(\S*dist\/server\/daemon\.js)(?:\s|$)/.exec(command);
  if (!match) {
    return null;
  }
  const daemonPath = match[1];
  const homebrewVersion =
    /\/Cellar\/gloss\/([^/]+)\/libexec\/lib\/node_modules\/getgloss\/dist\/server\/daemon\.js$/.exec(
      daemonPath
    )?.[1];
  return {
    daemonPath,
    ...(homebrewVersion ? { homebrewVersion } : {})
  };
}

function isMissingDaemonSource(processInfo: GlossDaemonProcess): boolean {
  return !existsSync(processInfo.daemonPath);
}

function isStaleHomebrewDaemon(processInfo: GlossDaemonProcess): boolean {
  return Boolean(processInfo.homebrewVersion && processInfo.homebrewVersion !== packageVersion);
}

function daemonSourceKey(processInfo: GlossDaemonProcess): string {
  return daemonPathSourceKey(processInfo.daemonPath);
}

function daemonPathSourceKey(daemonPath: string): string {
  return path.normalize(daemonPath);
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
