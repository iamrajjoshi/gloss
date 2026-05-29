import open from 'open';

export async function openLocalPath(filePath: string): Promise<void> {
  await open(filePath, { wait: false });
}
