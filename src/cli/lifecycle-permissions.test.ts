import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { globalServerFile, globalStateDir, packageVersion } from '../shared/paths';
import type { ServerInfo } from '../shared/types';

const originalStateDir = process.env.GLOSS_STATE_DIR;
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
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('lifecycle server info permission recovery', () => {
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
          new Response(JSON.stringify({ ok: true, version: packageVersion, activeReviews: 0 }), {
            headers: { 'content-type': 'application/json' }
          })
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
});

async function useTempStateDir(): Promise<void> {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-lifecycle-permissions-state-'));
  tempDirs = [stateDir];
  process.env.GLOSS_STATE_DIR = stateDir;
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

function makeServerInfo(pid: number, port: number): ServerInfo {
  return {
    pid,
    port,
    version: packageVersion,
    startedAt: '2026-05-23T12:00:00.000Z',
    stateDir: globalStateDir()
  };
}

function serializeServerInfo(info: ServerInfo): string {
  return `${JSON.stringify(info, null, 2)}\n`;
}

function permissionError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'EPERM';
  return error;
}
