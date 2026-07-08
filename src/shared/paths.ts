import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import packageJson from '../../package.json';

export const packageVersion = packageJson.version;
export const protocolVersion = 1;

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

export function globalLastPortFile(): string {
  return path.join(globalStateDir(), 'last-port');
}

export function globalServerLockDir(): string {
  return path.join(globalStateDir(), 'server.lock');
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

export function globalReviewTurnsDir(reviewId: string): string {
  return path.join(globalReviewDir(reviewId), 'turns');
}

export function globalReviewTurnDir(reviewId: string, turnId: string): string {
  return path.join(globalReviewTurnsDir(reviewId), turnId);
}

export function globalReviewTurnMetaFile(reviewId: string, turnId: string): string {
  return path.join(globalReviewTurnDir(reviewId, turnId), 'turn.json');
}

export function globalReviewTurnDiffFile(reviewId: string, turnId: string): string {
  return path.join(globalReviewTurnDir(reviewId, turnId), 'diff.json');
}

export function globalReviewTurnFeedbackFile(reviewId: string, turnId: string): string {
  return path.join(globalReviewTurnDir(reviewId, turnId), 'feedback.json');
}

export function globalReviewTurnMarkdownFile(reviewId: string, turnId: string): string {
  return path.join(globalReviewTurnDir(reviewId, turnId), 'feedback.md');
}

export function globalReviewTurnResolvedFile(reviewId: string, turnId: string): string {
  return path.join(globalReviewTurnDir(reviewId, turnId), 'resolved.json');
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

export function globalReviewEventsFile(reviewId: string): string {
  return path.join(globalReviewDir(reviewId), 'events.jsonl');
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
