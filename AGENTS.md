# Gloss Agent Notes

Gloss is a local diff-review tool for coding-agent loops. Keep changes simple,
verifiable, and scoped to the v0.1 flow unless the user asks otherwise.

## Project Commands

- Install: `pnpm install`
- Build: `pnpm build`
- Test: `pnpm test`
- Lint/format check: `pnpm check`
- Typecheck: `pnpm exec tsc --noEmit`
- Dev web UI: `pnpm dev:web`
- Local CLI after build: `node dist/cli/index.js --help`
- Render Homebrew formula: `pnpm homebrew:formula -- --version 0.1.0 --sha256 <sha256>`

## Architecture

- CLI, server, MCP, and shared code are TypeScript under `src/`.
- React/Vite web UI lives under `src/web/`.
- Background server state is written to `~/.gloss/server.json` by default.
- Review feedback is persisted under `<repo>/.gloss/reviews/<reviewId>/`.
- Keep shared API/data shapes in `src/shared/types.ts`.

## Workflow

- Branches should follow `raj--<feature_area>--<something>`.
- Commits should use `:emoji: verb[area]: brief description`.
- For Codex-assisted commits, include a `Generated-by: Codex` trailer.
- Do not add fake `Co-authored-by` trailers.
- Validate changes before marking work complete.
