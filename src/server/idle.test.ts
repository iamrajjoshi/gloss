import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIdleScheduler,
  DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
  normalizeIdleTimeoutMs
} from './idle';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('normalizeIdleTimeoutMs', () => {
  it('keeps positive timeout values', () => {
    expect(normalizeIdleTimeoutMs('2500')).toBe(2500);
  });

  it('falls back to the default timeout for disabled or invalid values', () => {
    const warn = vi.fn();

    expect(normalizeIdleTimeoutMs('0', warn)).toBe(DEFAULT_DAEMON_IDLE_TIMEOUT_MS);
    expect(normalizeIdleTimeoutMs('-1', warn)).toBe(DEFAULT_DAEMON_IDLE_TIMEOUT_MS);
    expect(normalizeIdleTimeoutMs('not-a-number', warn)).toBe(DEFAULT_DAEMON_IDLE_TIMEOUT_MS);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe('createIdleScheduler', () => {
  it('shuts down after the idle timeout when there are no live clients', async () => {
    vi.useFakeTimers();
    const shutdown = vi.fn();
    const scheduler = createIdleScheduler({
      timeoutMs: 100,
      hasLiveClients: () => false,
      isShuttingDown: () => false,
      shutdown
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(99);
    expect(shutdown).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('does not let a pending review artifact keep the daemon alive by itself', async () => {
    vi.useFakeTimers();
    const shutdown = vi.fn();
    const scheduler = createIdleScheduler({
      timeoutMs: 100,
      hasLiveClients: () => false,
      isShuttingDown: () => false,
      shutdown
    });

    scheduler.schedule();

    await vi.advanceTimersByTimeAsync(100);
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('waits while a live client is connected and reschedules after it disconnects', async () => {
    vi.useFakeTimers();
    let connections = 0;
    const shutdown = vi.fn();
    const scheduler = createIdleScheduler({
      timeoutMs: 100,
      hasLiveClients: () => connections > 0,
      isShuttingDown: () => false,
      shutdown
    });

    scheduler.schedule();
    connections = 1;
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(shutdown).not.toHaveBeenCalled();

    connections = 0;
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
