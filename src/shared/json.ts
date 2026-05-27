import { writeFile } from 'node:fs/promises';

function serializeJson(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJsonFile(filePath: string, value: object): Promise<void> {
  await writeFile(filePath, serializeJson(value));
}
