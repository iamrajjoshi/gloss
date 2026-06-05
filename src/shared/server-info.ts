import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatError, isFileNotFound, isPermissionError } from './errors';
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
    if (isPermissionError(error)) {
      throw new Error(serverInfoPermissionMessage('read', error), { cause: error });
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
  try {
    await ensureDir(globalStateDir());
  } catch (error) {
    if (isPermissionError(error)) {
      throw new Error(serverInfoPermissionMessage('create', error), { cause: error });
    }
    throw error;
  }

  try {
    await writeJsonFile(globalServerFile(), info);
  } catch (error) {
    if (!isPermissionError(error)) {
      throw error;
    }
    await assertStateDirWritable();
    try {
      await writeFile(globalServerFile(), serializeServerInfo(info));
    } catch (directWriteError) {
      throw new Error(serverInfoPermissionMessage('write', directWriteError), {
        cause: directWriteError
      });
    }
  }
}

export async function removeServerInfoFile(): Promise<string | null> {
  try {
    await rm(globalServerFile(), { force: true });
    return null;
  } catch (error) {
    return serverInfoPermissionMessage('remove', error);
  }
}

export function serverInfoPermissionMessage(action: string, error: unknown): string {
  const stateDir = globalStateDir();
  const source = process.env.GLOSS_STATE_DIR
    ? `GLOSS_STATE_DIR=${stateDir}`
    : 'GLOSS_STATE_DIR is not set; defaulting to ~/.gloss';
  return [
    `Could not ${action} Gloss server state at ${globalServerFile()}: ${formatError(error)}.`,
    '`server.json` is not a review lock, so there is nothing to unlock after a review.',
    `Check that ${stateDir} and ${globalServerFile()} are owned and writable by your user.`,
    `On macOS, if the file is immutable, run \`chflags nouchg "${globalServerFile()}"\`.`,
    `For sandboxed agents, set GLOSS_STATE_DIR to a writable directory. ${source}.`
  ].join(' ');
}

function serializeServerInfo(info: ServerInfo): string {
  return `${JSON.stringify(info, null, 2)}\n`;
}

async function assertStateDirWritable(): Promise<void> {
  const probePath = path.join(
    globalStateDir(),
    `.server.json.${process.pid}.${randomUUID()}.probe`
  );
  try {
    await writeFile(probePath, '');
    await rm(probePath, { force: true });
  } catch (error) {
    await rm(probePath, { force: true }).catch(() => undefined);
    throw new Error(serverInfoPermissionMessage('write', error), { cause: error });
  }
}
