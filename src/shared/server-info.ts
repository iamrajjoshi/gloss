import { readFile } from 'node:fs/promises';
import { writeJsonFile } from './json';
import { ensureDir, globalServerFile, globalStateDir } from './paths';
import type { ServerInfo } from './types';
import { isServerInfo, parseJson } from './validation';

export async function readServerInfo(): Promise<ServerInfo | null> {
  let raw: string;
  try {
    raw = await readFile(globalServerFile(), 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) {
      return null;
    }
    throw new Error(`Could not read server info at ${globalServerFile()}: ${formatError(error)}`, {
      cause: error
    });
  }

  try {
    return parseJson(raw, isServerInfo, 'server info');
  } catch (error) {
    throw new Error(`Invalid server info at ${globalServerFile()}: ${formatError(error)}`, {
      cause: error
    });
  }
}

export async function writeServerInfo(info: ServerInfo): Promise<void> {
  await ensureDir(globalStateDir());
  await writeJsonFile(globalServerFile(), info);
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
