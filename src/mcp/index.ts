import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { ensureServer, serverUrl } from '../cli/lifecycle';
import { ServerClient } from '../cli/server-client';
import { packageVersion } from '../shared/paths';

function textResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}

async function client(): Promise<ServerClient> {
  const info = await ensureServer();
  return new ServerClient(serverUrl(info));
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'gloss',
    version: packageVersion
  });

  server.registerTool(
    'list_pending_reviews',
    {
      title: 'List pending Gloss reviews',
      description: 'List pending local Gloss review sessions.'
    },
    async () => {
      const api = await client();
      const { reviews } = await api.listReviews();
      return textResult({ reviews: reviews.filter((review) => review.status === 'pending') });
    }
  );

  server.registerTool(
    'get_review',
    {
      title: 'Get Gloss review',
      description: 'Fetch review metadata and diff payload.',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => textResult(await (await client()).getReview(id))
  );

  server.registerTool(
    'watch_review',
    {
      title: 'Watch Gloss review',
      description: 'Block until a review completes, then return feedback.',
      inputSchema: {
        id: z.string(),
        timeout: z.number().optional()
      }
    },
    async ({ id, timeout }) => {
      const api = await client();
      await api.watchReview(id, timeout);
      return textResult(await api.getFeedback(id));
    }
  );

  server.registerTool(
    'get_review_feedback',
    {
      title: 'Get Gloss review feedback',
      description: 'Fetch completed review feedback.',
      inputSchema: { id: z.string() }
    },
    async ({ id }) => textResult(await (await client()).getFeedback(id))
  );

  server.registerTool(
    'mark_review_resolved',
    {
      title: 'Mark Gloss review resolved',
      description: 'Write a resolved marker for a completed review.',
      inputSchema: {
        id: z.string(),
        summary: z.string().optional()
      }
    },
    async ({ id, summary }) => textResult(await (await client()).markResolved(id, summary))
  );

  await server.connect(new StdioServerTransport());
}
