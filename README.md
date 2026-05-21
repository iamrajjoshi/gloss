# Gloss

Gloss is a local browser review loop for coding agents. It captures your current
git diff, opens a localhost review UI, lets you attach comments to changed
lines or ranges, and writes structured feedback back into the repo for an
agent to re-ingest.

## Install

```bash
npm install -g getgloss
gloss open --base HEAD --json
```

For one-off use:

```bash
npx getgloss open --base HEAD --json
```

For agent setup, use the Roughdraft-style prompt:

```text
Install Gloss for me using `npm i -g getgloss`, then read https://getgloss.dev/setup.md and set yourself up to use it.
```

The hosted install script is npm-only:

```bash
curl -fsSL https://getgloss.dev/install.sh | sh
```

## Commands

```text
gloss open [--base <ref>] [--print-url] [--no-open] [--json] [--no-watch] [--timeout <s>]
gloss watch <reviewId>
gloss start [--port <port>]
gloss status
gloss stop
gloss mcp
gloss doctor
```

`gloss open` lazy-starts a background server, captures tracked and untracked
changes against the base ref, registers a review session, opens
`http://localhost:<port>/review/<reviewId>`, and waits for submission unless
`--no-watch` is passed.

## Feedback Files

Completed reviews are written to:

```text
<repo>/.gloss/reviews/<reviewId>/
  meta.json
  diff.json
  feedback.json
  feedback.md
  original/
```

`feedback.json` is the agent-friendly source of truth. `feedback.md` is a
human-readable summary ordered by file and line.

## MCP

`gloss mcp` starts a stdio MCP server exposing:

- `list_pending_reviews`
- `get_review`
- `watch_review`
- `get_review_feedback`
- `mark_review_resolved`

The MCP process talks to the same localhost server as the CLI.

## Development

```bash
pnpm dev:web
pnpm build
pnpm test
pnpm check
pnpm setup
```

`pnpm setup` creates a per-worktree wrapper in `~/.local/bin` named
`gloss-dev-<worktree>`, using an isolated state dir under `~/.gloss/dev/`.

## Release Flow

Releases follow Willow's tag-driven shape:

1. Push a tag like `v0.1.0`.
2. GitHub Actions runs checks, tests, and the production build.
3. The package is published to npm as `getgloss`.
4. A GitHub release is created with `npm pack` output and checksums.

Required repository secrets:

- `NPM_TOKEN`

## Attribution

Gloss uses [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs) by
[The Pierre Computer Company](https://pierre.computer/) for diff parsing and
rendering integration points, with Gloss-specific browser chrome around the
local review workflow.

`@pierre/diffs` is licensed under Apache-2.0. Gloss is not affiliated with or
endorsed by The Pierre Computer Company.
