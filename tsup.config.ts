import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'server/daemon': 'src/server/daemon.ts'
  },
  clean: false,
  dts: false,
  format: ['esm'],
  minify: false,
  outDir: 'dist',
  platform: 'node',
  sourcemap: true,
  splitting: false,
  target: 'node20'
});
