import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  DiffPayload,
  FeedbackBundle,
  ResolutionBundle,
  ReviewMeta,
  ReviewTurnMeta,
  ServerInfo
} from './types';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

type PersistedJson =
  | ServerInfo
  | ReviewMeta
  | ReviewTurnMeta
  | DiffPayload
  | FeedbackBundle
  | ResolutionBundle;

function serializeJson(value: PersistedJson): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJsonFile(filePath: string, value: PersistedJson): Promise<void> {
  await writeTextFile(filePath, serializeJson(value));
}

export async function writeTextFile(filePath: string, value: string): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(tempPath, value);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
