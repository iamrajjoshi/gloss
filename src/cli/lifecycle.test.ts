import { afterEach, describe, expect, it, vi } from 'vitest';
import { packageVersion } from '../shared/paths';
import type { ServerInfo } from '../shared/types';
import { isServerResponsive } from './lifecycle';

const serverInfo: ServerInfo = {
  pid: process.pid,
  port: 12345,
  version: packageVersion,
  startedAt: '2026-05-26T00:00:00.000Z',
  stateDir: '/tmp/gloss-test'
};

afterEach(() => {
  vi.restoreAllMocks();
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
