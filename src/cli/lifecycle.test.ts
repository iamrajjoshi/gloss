import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { globalServerFile, packageVersion } from '../shared/paths';
import { readServerInfo, writeServerInfo } from '../shared/server-info';
import type { ServerInfo } from '../shared/types';
import {
  isServerResponsive,
  parseGlossDaemonPids,
  parseGlossDaemonProcesses,
  stopServer
} from './lifecycle';

const serverInfo: ServerInfo = {
  pid: process.pid,
  port: 12345,
  version: packageVersion,
  startedAt: '2026-05-26T00:00:00.000Z',
  stateDir: '/tmp/gloss-test'
};

const originalStateDir = process.env.GLOSS_STATE_DIR;
let tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalStateDir === undefined) {
    delete process.env.GLOSS_STATE_DIR;
  } else {
    process.env.GLOSS_STATE_DIR = originalStateDir;
  }
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('isServerResponsive', () => {
  it('requires the daemon health version to match the CLI version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, version: '0.3.0', activeReviews: 0 }), {
            headers: { 'content-type': 'application/json' }
          })
      )
    );

    await expect(isServerResponsive(serverInfo)).resolves.toBe(false);
  });

  it('accepts a healthy daemon running the same version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, version: packageVersion, activeReviews: 0 }), {
            headers: { 'content-type': 'application/json' }
          })
      )
    );

    await expect(isServerResponsive(serverInfo)).resolves.toBe(true);
  });
});

describe('stopServer', () => {
  it('removes stale server info when the recorded pid is already gone', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'gloss-lifecycle-state-'));
    tempDirs = [stateDir];
    process.env.GLOSS_STATE_DIR = stateDir;
    await writeServerInfo({ ...serverInfo, pid: 987654, stateDir });
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | 0) => {
      if (pid === 987654 && signal === 0) {
        throw new Error('missing process');
      }
      return true;
    }) as typeof process.kill);

    await expect(stopServer()).resolves.toEqual({
      stopped: false,
      info: { ...serverInfo, pid: 987654, stateDir }
    });
    await expect(readServerInfo()).resolves.toBeNull();
    await expect(rm(globalServerFile(), { force: true })).resolves.toBeUndefined();
  });
});

describe('parseGlossDaemonPids', () => {
  it('finds current-user Gloss daemon commands and ignores unrelated processes', () => {
    const stdout = [
      ' 111 raj.joshi /opt/homebrew/bin/node /Users/raj/proj/gloss/dist/server/daemon.js',
      ' 222 other /opt/homebrew/bin/node /Users/raj/proj/gloss/dist/server/daemon.js',
      ' 333 raj.joshi rg dist/server/daemon.js',
      ' 444 raj.joshi /opt/homebrew/bin/node /opt/homebrew/lib/node_modules/getgloss/dist/server/daemon.js'
    ].join('\n');

    expect(parseGlossDaemonPids(stdout, 'raj.joshi', 333)).toEqual([111, 444]);
  });

  it('returns daemon metadata for stale-source decisions', () => {
    const stdout = [
      ' 111 raj.joshi /opt/homebrew/bin/node /Users/raj/proj/gloss/dist/server/daemon.js',
      ' 222 raj.joshi /opt/homebrew/bin/node /opt/homebrew/Cellar/gloss/0.7.1/libexec/lib/node_modules/getgloss/dist/server/daemon.js'
    ].join('\n');

    expect(parseGlossDaemonProcesses(stdout, 'raj.joshi')).toEqual([
      {
        pid: 111,
        user: 'raj.joshi',
        command: '/opt/homebrew/bin/node /Users/raj/proj/gloss/dist/server/daemon.js',
        daemonPath: '/Users/raj/proj/gloss/dist/server/daemon.js'
      },
      {
        pid: 222,
        user: 'raj.joshi',
        command:
          '/opt/homebrew/bin/node /opt/homebrew/Cellar/gloss/0.7.1/libexec/lib/node_modules/getgloss/dist/server/daemon.js',
        daemonPath:
          '/opt/homebrew/Cellar/gloss/0.7.1/libexec/lib/node_modules/getgloss/dist/server/daemon.js',
        homebrewVersion: '0.7.1'
      }
    ]);
  });
});
