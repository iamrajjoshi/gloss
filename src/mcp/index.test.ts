import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { createGlossMcpRuntime } from './index';

const repos: string[] = [];

async function git(args: string[], cwd: string): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trimEnd();
}

async function write(repo: string, filePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(repo, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function createRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'gloss-mcp-'));
  repos.push(repo);
  await git(['init', '-b', 'main'], repo);
  await git(['config', 'user.email', 'gloss@example.com'], repo);
  await git(['config', 'user.name', 'Gloss Test'], repo);
  await write(repo, 'app.ts', 'export const value = 1;\n');
  await git(['add', '.'], repo);
  await git(['commit', '-m', 'initial'], repo);
  await write(repo, 'app.ts', 'export const value = 2;\n');
  return repo;
}

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('Gloss MCP runtime', () => {
  it('opens a review and waits for browser-submitted feedback', async () => {
    const repo = await createRepo();
    const runtime = createGlossMcpRuntime();
    const client = new Client({ name: 'gloss-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await runtime.server.connect(serverTransport);
      await client.connect(clientTransport);

      const opened = await client.callTool({
        name: 'open_review',
        arguments: { cwd: repo, open: false }
      });
      const openedContent = opened.structuredContent as {
        reviewId: string;
        url: string;
        files: number;
      };

      expect(openedContent.files).toBe(1);

      const wait = client.callTool({
        name: 'wait_for_review',
        arguments: { id: openedContent.reviewId, timeout: 2 }
      });

      const submitted = await fetch(
        `${openedContent.url.replace(/\/review\/.*/, '')}/api/reviews/${openedContent.reviewId}/submit`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            comments: [
              {
                id: 'comment-1',
                filePath: 'app.ts',
                startLine: 1,
                endLine: 1,
                side: 'R',
                body: 'Please adjust this.',
                originalSnippet: 'export const value = 2;',
                createdAt: '2026-05-23T00:00:00.000Z'
              }
            ]
          })
        }
      );
      expect(submitted.ok).toBe(true);

      const completed = await wait;
      expect(completed.structuredContent).toMatchObject({
        reviewId: openedContent.reviewId,
        status: 'completed',
        feedback: {
          reviewId: openedContent.reviewId,
          comments: [{ body: 'Please adjust this.' }]
        }
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});
