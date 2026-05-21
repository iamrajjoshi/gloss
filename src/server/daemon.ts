import { serve } from '@hono/node-server';
import { writeServerInfo } from '../cli/lifecycle';
import { globalStateDir, packageVersion } from '../shared/paths';
import { createApp } from './index';

const port = Number(process.env.GLOSS_PORT ?? '0');

if (!port) {
  throw new Error('GLOSS_PORT is required');
}

const origin = `http://localhost:${port}`;
const server = serve({
  fetch: createApp(origin).fetch,
  port
});

await writeServerInfo({
  pid: process.pid,
  port,
  version: packageVersion,
  startedAt: new Date().toISOString(),
  stateDir: globalStateDir()
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
