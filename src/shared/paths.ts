import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const packageVersion = '0.1.0';

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

export function repoGlossDir(cwd: string): string {
  return path.join(cwd, '.gloss');
}

export function reviewsDir(cwd: string): string {
  return path.join(repoGlossDir(cwd), 'reviews');
}

export function reviewDir(cwd: string, reviewId: string): string {
  return path.join(reviewsDir(cwd), reviewId);
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
