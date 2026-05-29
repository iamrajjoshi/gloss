<p align="center">
  <img src="public/logo.svg" alt="Gloss logo" width="88" height="88" />
</p>

# Gloss

Gloss is a local browser review loop for coding agents. It captures your current
git diff, opens a localhost review UI, lets you attach comments to changed
lines or ranges, and writes structured feedback under `~/.gloss` for an agent
to re-ingest.

## Install

```bash
brew install iamrajjoshi/tap/gloss
gloss open --json
```

With npm:

```bash
npm install -g getgloss
gloss open --json
```

For one-off use:

```bash
npx getgloss open --json
```

For a new agent chat, use:

```text
Install Gloss with Homebrew or npm. Then read https://getgloss.dev/setup.md.
```

### Claude Code Skill

Gloss ships a packaged Claude Code skill at `skill/SKILL.md`. Install it with
the [`skills` CLI](https://github.com/vercel-labs/agent-skills):

```bash
# Global (available across all projects)
npx skills add iamrajjoshi/gloss --skill gloss -g -a claude-code

# Project-local (only inside the current project)
npx skills add iamrajjoshi/gloss --skill gloss -a claude-code
```

`-g` installs to `~/.claude/skills/`, `-a claude-code` targets Claude Code, and
`--skill gloss` installs only the Gloss skill folder from the repo. The skill
teaches agents to run `gloss open --json`, wait for browser submission, read
`feedbackPath`, apply comments, validate, and mark comments or the review
resolved with `gloss resolve`.

The hosted install script installs the npm package:

```bash
curl -fsSL https://getgloss.dev/install.sh | sh
```

## Commands

```text
gloss open [--base <ref>] [--print-url] [--no-open] [--json] [--no-watch] [--timeout <s>]
gloss watch <reviewId>
gloss resolve <reviewId> [--comment <commentId>] [--summary <text>] [--json]
gloss start [--port <port>]
gloss status
gloss stop
gloss doctor
```

`gloss open` lazy-starts a background server, captures staged, unstaged, and
untracked working changes, registers a review session, opens
`http://localhost:<port>/review/<reviewId>`, and waits for submission unless
`--no-watch` is passed. When the working tree is clean and no explicit
`--base` is provided, Gloss falls back to the current branch diff against the
best available merge-base from upstream, `origin/HEAD`, `origin/main`, or
`origin/master`.

Use `--base <ref>` when you want an explicit comparison. Explicit base mode
compares only against the requested ref and does not switch to a branch diff.

## Review UI

In the browser review, drag over a changed line or range to open a draft
comment. Use `Command+Enter` to save the active draft comment. Use
`Command+Shift+Enter` to submit the review; this matches the Submit button and
includes already-saved comments only.

## Feedback Files

Submitted reviews are written to:

```text
~/.gloss/reviews/<reviewId>/
  meta.json
  diff.json
  feedback.json
  feedback.md
  resolved.json
```

`feedback.json` is the machine-readable payload. `feedback.md` is a readable
summary ordered by file and line. `resolved.json` is mutable resolution
progress for individual comments and the full review. After applying feedback,
use `gloss resolve <reviewId> --comment <commentId> --summary "..."` for a
single comment or `gloss resolve <reviewId> --summary "..."` for the whole
review. Set `GLOSS_STATE_DIR` to use an isolated state root for tests or
development.
For a follow-up pass after fixes or new commits, start a fresh session with
`gloss open --json`.

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
5. The Homebrew formula is updated in `iamrajjoshi/homebrew-tap`.

Required repository secrets:

- `NPM_TOKEN`
- `HOMEBREW_TAP_GITHUB_TOKEN`
