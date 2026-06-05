import { writeFile as actualWriteFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { globalServerFile, globalStateDir, packageVersion } from './paths';
import type { ServerInfo } from './types';

const originalStateDir = process.env.GLOSS_STATE_DIR;
let tempDirs: string[] = [];

afterEach(async () => {
  vi.resetModules();
  vi.doUnmock('./json');
  vi.doUnmock('node:fs/promises');
  if (originalStateDir === undefined) {
    delete process.env.GLOSS_STATE_DIR;
  } else {
    process.env.GLOSS_STATE_DIR = originalStateDir;
  }
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('server info persistence', () => {
  it('falls back to direct server.json overwrite when atomic replace is denied', async () => {
    await useTempStateDir();
    vi.doMock('./json', () => ({
      writeJsonFile: vi.fn(async () => {
        throw permissionError('rename denied');
      })
    }));
    const { readServerInfo, writeServerInfo } = await import('./server-info');

    await writeServerInfo(makeServerInfo(12345));

    const raw = JSON.parse(await readFile(globalServerFile(), 'utf8'));
    expect(raw.pid).toBe(12345);
    await expect(readServerInfo()).resolves.toMatchObject({ pid: 12345 });
  });

  it('explains server.json is not a review lock when both write paths fail', async () => {
    await useTempStateDir();
    vi.doMock('./json', () => ({
      writeJsonFile: vi.fn(async () => {
        throw permissionError('rename denied');
      })
    }));
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        writeFile: vi.fn(async (target: unknown, value: unknown, options?: unknown) => {
          if (target === globalServerFile()) {
            throw permissionError('direct write denied', 'EACCES');
          }
          return actual.writeFile(target as any, value as any, options as any);
        })
      };
    });
    const { writeServerInfo } = await import('./server-info');

    await expect(writeServerInfo(makeServerInfo(12345))).rejects.toThrow(
      /server\.json` is not a review lock/
    );
  });

  it('does not mask an unwritable state directory with the direct overwrite fallback', async () => {
    await useTempStateDir();
    await mkdir(path.dirname(globalServerFile()), { recursive: true });
    await actualWriteFile(globalServerFile(), serializeServerInfo(makeServerInfo(11111)));
    vi.doMock('./json', () => ({
      writeJsonFile: vi.fn(async () => {
        throw permissionError('temp write denied');
      })
    }));
    const writeFileMock = vi.fn(async (target: unknown, value: unknown, options?: unknown) => {
      if (target !== globalServerFile()) {
        throw permissionError('probe write denied', 'EACCES');
      }
      return actualWriteFile(target as any, value as any, options as any);
    });
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        writeFile: writeFileMock
      };
    });
    const { writeServerInfo } = await import('./server-info');

    await expect(writeServerInfo(makeServerInfo(22222))).rejects.toThrow(/probe write denied/);

    expect(writeFileMock).not.toHaveBeenCalledWith(globalServerFile(), expect.anything());
    expect(JSON.parse(await readFile(globalServerFile(), 'utf8'))).toMatchObject({ pid: 11111 });
  });
});

async function useTempStateDir(): Promise<void> {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-server-info-state-'));
  tempDirs = [stateDir];
  process.env.GLOSS_STATE_DIR = stateDir;
  await mkdir(stateDir, { recursive: true });
}

function makeServerInfo(pid: number): ServerInfo {
  return {
    pid,
    port: 1234,
    version: packageVersion,
    startedAt: '2026-05-23T12:00:00.000Z',
    stateDir: globalStateDir()
  };
}

function serializeServerInfo(info: ServerInfo): string {
  return `${JSON.stringify(info, null, 2)}\n`;
}

function permissionError(
  message: string,
  code: 'EACCES' | 'EPERM' = 'EPERM'
): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}
