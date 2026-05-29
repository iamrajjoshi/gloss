import { writeFile } from 'node:fs/promises';
import type {
  DiffPayload,
  FeedbackBundle,
  ResolutionBundle,
  ReviewMeta,
  ServerInfo
} from './types';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

type PersistedJson = ServerInfo | ReviewMeta | DiffPayload | FeedbackBundle | ResolutionBundle;

function serializeJson(value: PersistedJson): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJsonFile(filePath: string, value: PersistedJson): Promise<void> {
  await writeFile(filePath, serializeJson(value));
}
