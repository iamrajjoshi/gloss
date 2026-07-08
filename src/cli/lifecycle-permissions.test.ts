import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  globalLastPortFile,
  globalServerFile,
  globalServerLockDir,
  globalStateDir,
  packageVersion,
  protocolVersion
} from '../shared/paths';
import type { ServerInfo } from '../shared/types';

const originalStateDir = process.env.GLOSS_STATE_DIR;
const originalSkipStaleDaemonReap = process.env.GLOSS_SKIP_STALE_DAEMON_REAP;
let tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.doUnmock('node:child_process');
  vi.doUnmock('node:fs');
  vi.doUnmock('node:fs/promises');
  if (originalStateDir === undefined) {
    delete process.env.GLOSS_STATE_DIR;
  } else {
    process.env.GLOSS_STATE_DIR = originalStateDir;
  }
  if (originalSkipStaleDaemonReap === undefined) {
    delete process.env.GLOSS_SKIP_STALE_DAEMON_REAP;
  } else {
    process.env.GLOSS_SKIP_STALE_DAEMON_REAP = originalSkipStaleDaemonReap;
  }
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('lifecycle server info permission recovery', () => {
  it('reuses the last successful port when server.json is gone', async () => {
    await useTempStateDir();
    await writeFile(globalLastPortFile(), '45678\n');
    const spawnMock = vi.fn(
      (_command: string, _args: string[], _options: { env?: NodeJS.ProcessEnv }) => ({
        pid: 12345,
        unref: vi.fn()
      })
    );
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return { ...actual, existsSync: vi.fn(() => true) };
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, spawn: spawnMock };
    });
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (pid === 12345 && signal === 0) {
        return true;
      }
      return true;
    }) as typeof process.kill);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              version: packageVersion,
              protocolVersion,
              activeReviews: 0,
              stateDir: globalStateDir(),
              daemonPath: daemonPathForHealth()
            }),
            {
              headers: { 'content-type': 'application/json' }
            }
          )
      )
    );
    const { ensureServer } = await import('./lifecycle');

    const info = await ensureServer();

    expect(info).toMatchObject({ pid: 12345, port: 45678 });
    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock.mock.calls[0]?.[2]?.env?.GLOSS_PORT).toBe('45678');
    await expect(readFile(globalLastPortFile(), 'utf8')).resolves.toBe('45678\n');
  });

  it('keeps the healthy daemon when remembering the last port is denied', async () => {
    await useTempStateDir();
    const spawnMock = vi.fn(
      (_command: string, _args: string[], _options: { env?: NodeJS.ProcessEnv }) => ({
        pid: 12345,
        unref: vi.fn()
      })
    );
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return { ...actual, existsSync: vi.fn(() => true) };
    });
    const writeFileMock = vi.fn(async (target: unknown, data: unknown, options?: unknown) => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      if (target === globalLastPortFile()) {
        throw permissionError('last-port denied');
      }
      return actual.writeFile(target as any, data as any, options as any);
    });
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return { ...actual, writeFile: writeFileMock };
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, spawn: spawnMock };
    });
    const killMock = vi.spyOn(process, 'kill').mockImplementation(((
      pid: number,
      signal?: NodeJS.Signals | 0
    ) => {
      if (pid === 12345 && signal === 0) {
        return true;
      }
      return true;
    }) as typeof process.kill);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              version: packageVersion,
              protocolVersion,
              activeReviews: 0,
              stateDir: globalStateDir(),
              daemonPath: daemonPathForHealth()
            }),
            {
              headers: { 'content-type': 'application/json' }
            }
          )
      )
    );
    const { ensureServer } = await import('./lifecycle');

    const info = await ensureServer();

    expect(info).toMatchObject({ pid: 12345 });
    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock.mock.calls[0]?.[2]?.env?.GLOSS_PORT).toBe(String(info.port));
    expect(writeFileMock).toHaveBeenCalledWith(globalLastPortFile(), `${info.port}\n`);
    expect(killMock).not.toHaveBeenCalledWith(12345, 'SIGTERM');
  });

  it('starts a new daemon when stale server.json cleanup is denied', async () => {
    await useTempStateDir();
    await writeFile(globalServerFile(), serializeServerInfo(makeServerInfo(987654, 43210)));
    const rmMock = mockServerInfoRemovalDenied();
    const spawnMock = vi.fn(() => ({ pid: 12345, unref: vi.fn() }));
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return { ...actual, existsSync: vi.fn(() => true) };
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, spawn: spawnMock };
    });
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (pid === 987654 && signal === 0) {
        throw permissionError('stale pid');
      }
      if (pid === 12345 && signal === 0) {
        return true;
      }
      return true;
    }) as typeof process.kill);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              version: packageVersion,
              protocolVersion,
              activeReviews: 0,
              stateDir: globalStateDir(),
              daemonPath: daemonPathForHealth()
            }),
            {
              headers: { 'content-type': 'application/json' }
            }
          )
      )
    );
    const { ensureServer } = await import('./lifecycle');

    const info = await ensureServer();

    expect(info).toMatchObject({ pid: 12345, port: 43210 });
    expect(spawnMock).toHaveBeenCalledOnce();
    expect(rmMock).toHaveBeenCalledWith(globalServerFile(), { force: true });
    expect(JSON.parse(await readFile(globalServerFile(), 'utf8'))).toMatchObject({ pid: 12345 });
  });

  it('returns a warning when stop --all cannot remove server.json', async () => {
    await useTempStateDir();
    const daemonPid = 23456;
    await writeFile(globalServerFile(), serializeServerInfo(makeServerInfo(daemonPid, 43210)));
    mockServerInfoRemovalDenied();
    const execFileMock = vi.fn() as ReturnType<typeof vi.fn> & {
      [promisify.custom]: () => Promise<{ stdout: string }>;
    };
    execFileMock[promisify.custom] = vi.fn(async () => ({
      stdout: ` ${daemonPid} ${userInfo().username} /opt/homebrew/bin/node /tmp/gloss/dist/server/daemon.js\n`
    }));
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFile: execFileMock };
    });
    let daemonAlive = true;
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (pid !== daemonPid) {
        return true;
      }
      if (signal === 0) {
        if (daemonAlive) {
          return true;
        }
        throw permissionError('stopped pid');
      }
      if (signal === 'SIGTERM') {
        daemonAlive = false;
        return true;
      }
      return true;
    }) as typeof process.kill);
    const { stopServer } = await import('./lifecycle');

    const result = await stopServer({ all: true });

    expect(result.stopped).toBe(true);
    expect(result.stoppedPids).toEqual([daemonPid]);
    expect(result.warning).toContain('server.json` is not a review lock');
  });

  it('serializes concurrent starts behind one server lock', async () => {
    await useTempStateDir();
    const spawnMock = vi.fn(() => ({ pid: 12345, unref: vi.fn() }));
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return { ...actual, existsSync: vi.fn(() => true) };
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, spawn: spawnMock };
    });
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (pid === 12345 && signal === 0) {
        return true;
      }
      return true;
    }) as typeof process.kill);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              version: packageVersion,
              protocolVersion,
              activeReviews: 0,
              stateDir: globalStateDir(),
              daemonPath: daemonPathForHealth()
            }),
            {
              headers: { 'content-type': 'application/json' }
            }
          )
      )
    );
    const { ensureServer } = await import('./lifecycle');

    const [first, second] = await Promise.all([ensureServer(), ensureServer()]);

    expect(first).toMatchObject({ pid: 12345 });
    expect(second).toMatchObject({ pid: 12345 });
    expect(spawnMock).toHaveBeenCalledOnce();
    await expect(readFile(path.join(globalServerLockDir(), 'owner.json'))).rejects.toThrow();
  });

  it('reaps missing, stale Homebrew, and duplicate same-source daemons conservatively', async () => {
    await useTempStateDir();
    delete process.env.GLOSS_SKIP_STALE_DAEMON_REAP;
    const managedDaemon = '/tmp/current-gloss/dist/server/daemon.js';
    const stdout = [
      ` 100 ${userInfo().username} /opt/homebrew/bin/node ${managedDaemon}`,
      ` 101 ${userInfo().username} /opt/homebrew/bin/node ${managedDaemon}`,
      ` 102 ${userInfo().username} /opt/homebrew/bin/node /tmp/gone-gloss/dist/server/daemon.js`,
      ` 103 ${userInfo().username} /opt/homebrew/bin/node /opt/homebrew/Cellar/gloss/0.7.1/libexec/lib/node_modules/getgloss/dist/server/daemon.js`,
      ` 104 ${userInfo().username} /opt/homebrew/bin/node /opt/homebrew/Cellar/gloss/${packageVersion}/libexec/lib/node_modules/getgloss/dist/server/daemon.js`,
      ' 105 other /opt/homebrew/bin/node /tmp/current-gloss/dist/server/daemon.js'
    ].join('\n');
    const execFileMock = vi.fn() as ReturnType<typeof vi.fn> & {
      [promisify.custom]: () => Promise<{ stdout: string }>;
    };
    execFileMock[promisify.custom] = vi.fn(async () => ({ stdout }));
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return { ...actual, execFile: execFileMock };
    });
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        existsSync: vi.fn((target: string) => target !== '/tmp/gone-gloss/dist/server/daemon.js')
      };
    });
    const alive = new Set([100, 101, 102, 103, 104]);
    const killed: number[] = [];
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (signal === 0) {
        if (alive.has(pid)) {
          return true;
        }
        throw permissionError('stopped pid');
      }
      killed.push(pid);
      alive.delete(pid);
      return true;
    }) as typeof process.kill);
    const { reapStaleDaemons } = await import('./lifecycle');

    const reaped = await reapStaleDaemons(makeServerInfo(100, 43210, managedDaemon));

    expect(reaped).toEqual([101, 102, 103]);
    expect(killed).toEqual([101, 102, 103]);
  });
});

async function useTempStateDir(): Promise<void> {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-lifecycle-permissions-state-'));
  tempDirs = [stateDir];
  process.env.GLOSS_STATE_DIR = stateDir;
  process.env.GLOSS_SKIP_STALE_DAEMON_REAP = '1';
}

function mockServerInfoRemovalDenied(): ReturnType<typeof vi.fn> {
  const rmMock = vi.fn(async (target: unknown, options?: unknown) => {
    if (target === globalServerFile()) {
      throw permissionError('operation not permitted');
    }
    return rm(target as any, options as any);
  });
  vi.doMock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, rm: rmMock };
  });
  return rmMock;
}

function makeServerInfo(pid: number, port: number, daemonPath?: string): ServerInfo {
  return {
    pid,
    port,
    version: packageVersion,
    startedAt: '2026-05-23T12:00:00.000Z',
    stateDir: globalStateDir(),
    ...(daemonPath ? { daemonPath } : {})
  };
}

function daemonPathForHealth(): string {
  return path.resolve('src/server/daemon.js');
}

function serializeServerInfo(info: ServerInfo): string {
  return `${JSON.stringify(info, null, 2)}\n`;
}

function permissionError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'EPERM';
  return error;
}
