import { DEFAULT_REVIEW_RETENTION_DAYS } from '../shared/cleanup';
import { formatError } from '../shared/errors';
import { reviewStore } from './store';

interface StartupCleanupLogger {
  info(message: string): void;
  error(message: string): void;
}

const defaultLogger: StartupCleanupLogger = {
  info: (message) => {
    process.stdout.write(`${message}\n`);
  },
  error: (message) => {
    process.stderr.write(`${message}\n`);
  }
};

export async function runStartupCleanup(
  logger: StartupCleanupLogger = defaultLogger
): Promise<void> {
  try {
    const result = await reviewStore.clearReviewArtifacts({
      olderThanDays: DEFAULT_REVIEW_RETENTION_DAYS
    });
    logger.info(
      `Gloss cleanup deleted ${result.counts.deleted} review artifact(s); skipped ${result.counts.skipped}`
    );
  } catch (error) {
    logger.error(`Gloss cleanup failed: ${formatError(error)}`);
  }
}
