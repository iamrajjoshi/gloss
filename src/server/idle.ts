export const DEFAULT_DAEMON_IDLE_TIMEOUT_MS = 120000;

export interface IdleScheduler {
  cancel: () => void;
  schedule: () => void;
}

interface IdleSchedulerOptions {
  timeoutMs: number;
  hasLiveClients: () => boolean;
  isShuttingDown: () => boolean;
  shutdown: () => void | Promise<void>;
}

export function normalizeIdleTimeoutMs(
  rawValue = process.env.GLOSS_IDLE_TIMEOUT_MS,
  warn: (message: string) => void = (message) => process.stderr.write(message)
): number {
  if (rawValue === undefined) {
    return DEFAULT_DAEMON_IDLE_TIMEOUT_MS;
  }

  const parsed = Number(rawValue);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  warn(
    `Warning: GLOSS_IDLE_TIMEOUT_MS=${JSON.stringify(rawValue)} is not positive; using ${DEFAULT_DAEMON_IDLE_TIMEOUT_MS}.\n`
  );
  return DEFAULT_DAEMON_IDLE_TIMEOUT_MS;
}

export function createIdleScheduler(options: IdleSchedulerOptions): IdleScheduler {
  let idleTimer: NodeJS.Timeout | null = null;

  const cancel = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const schedule = () => {
    if (options.isShuttingDown()) {
      return;
    }

    if (options.hasLiveClients()) {
      cancel();
      return;
    }

    if (!idleTimer) {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        void shutdownIfIdle();
      }, options.timeoutMs);
    }
  };

  const shutdownIfIdle = async () => {
    if (options.isShuttingDown()) {
      return;
    }
    if (options.hasLiveClients()) {
      schedule();
      return;
    }
    await options.shutdown();
  };

  return { cancel, schedule };
}
