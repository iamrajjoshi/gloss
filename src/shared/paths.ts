import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import packageJson from '../../package.json';

export const packageVersion = packageJson.version;

export function expandHome(input: string): string {
  if (input === '~') {
    return homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}

export function globalStateDir(): string {
  return expandHome(process.env.GLOSS_STATE_DIR ?? '~/.gloss');
}

export function globalServerFile(): string {
  return path.join(globalStateDir(), 'server.json');
}

export function globalLogDir(): string {
  return path.join(globalStateDir(), 'logs');
}

export function globalServerLogFile(): string {
  return path.join(globalLogDir(), 'server.log');
}

export function globalReviewsDir(): string {
  return path.join(globalStateDir(), 'reviews');
}

export function globalReviewDir(reviewId: string): string {
  return path.join(globalReviewsDir(), reviewId);
}

export function globalReviewMetaFile(reviewId: string): string {
  return path.join(globalReviewDir(reviewId), 'meta.json');
}

export function globalReviewDiffFile(reviewId: string): string {
  return path.join(globalReviewDir(reviewId), 'diff.json');
}

export function globalReviewFeedbackFile(reviewId: string): string {
  return path.join(globalReviewDir(reviewId), 'feedback.json');
}

export function globalReviewMarkdownFile(reviewId: string): string {
  return path.join(globalReviewDir(reviewId), 'feedback.md');
}

export function globalReviewResolvedFile(reviewId: string): string {
  return path.join(globalReviewDir(reviewId), 'resolved.json');
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
