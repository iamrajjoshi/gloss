import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

const cwd = process.cwd();
const worktreeName = slug(path.basename(cwd)) || 'gloss';
const binDir = path.join(homedir(), '.local', 'bin');
const wrapperName = `gloss-dev-${worktreeName}`;
const wrapperPath = path.join(binDir, wrapperName);
const stateDir = path.join(homedir(), '.gloss', 'dev', wrapperName);

await mkdir(binDir, { recursive: true });
await mkdir(stateDir, { recursive: true });

await writeFile(
  wrapperPath,
  `#!/usr/bin/env bash
set -euo pipefail
cd ${JSON.stringify(cwd)}
export GLOSS_STATE_DIR=${JSON.stringify(stateDir)}
pnpm build >/dev/null
exec node ${JSON.stringify(path.join(cwd, 'dist', 'cli', 'index.js'))} "$@"
`
);
await chmod(wrapperPath, 0o755);

process.stdout.write(`Installed ${wrapperName} at ${wrapperPath}\n`);
