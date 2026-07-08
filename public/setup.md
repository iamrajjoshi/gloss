# Gloss Agent Setup

You are setting yourself up to use Gloss, a local code-diff review tool for
coding-agent loops.

Gloss captures the current git diff, opens a localhost browser review UI, lets
the user attach comments to changed lines/ranges or the whole review, then
writes structured feedback under
`~/.gloss/reviews/<reviewId>/turns/<turnId>/`.

## Check Installation

Check whether Gloss is available:

```bash
gloss help
```

If Gloss is missing and the user has asked you to install it, install it with:

```bash
brew install iamrajjoshi/tap/gloss
```

If Homebrew is unavailable, use npm:

```bash
npm i -g getgloss
```

If the user did not explicitly ask you to install software, ask before
installing a global package.

## Install the Claude Code Skill

Gloss ships a packaged Claude Code skill at `skill/SKILL.md`. If the user wants
Claude Code to know when to use Gloss automatically, install it with the
`skills` CLI:

```bash
# Global (available across all projects)
npx skills add iamrajjoshi/gloss --skill gloss -g -a claude-code

# Project-local (only inside the current project)
npx skills add iamrajjoshi/gloss --skill gloss -a claude-code
```

Use the global install for a cross-project review workflow. Use the
project-local install only when the user wants Gloss behavior scoped to the
current repo.

The skill pairs the CLI with the browser app:

1. Run `gloss open --json` from the repo root unless the user names a base ref.
2. Wait for the browser review to be submitted.
3. Read `feedbackPath` from the JSON output.
4. Check `feedback.reviewScope`; scoped feedback means the human submitted while
   viewing one commit or commit range, not necessarily the whole turn.
5. Run `gloss claim <reviewId> --json` so the browser shows agent work started.
6. Address general comments first, then file comments in file and line order.
7. Optionally post progress with
   `gloss note <reviewId> --status working --message "<short status>"`.
8. Validate the fix with the narrowest relevant checks.
9. Optionally mark individual comments handled with
   `gloss resolve <reviewId> --comment <commentId> --summary "<what changed>"`.
10. Run `gloss resolve <reviewId> --summary "<what changed>"`, then summarize
   what changed.
11. For another pass on the same review, run
   `gloss open --review <reviewId> --json`.

Browser review shortcuts:

- `Command+Enter` saves the active draft comment.
- `Command+Shift+Enter` submits the review with already-saved comments.

The browser hides lockfiles by default and can also hide snapshots, generated
code, and vendored code. Those filters affect only the browser view; submitted
feedback still refers to the full captured diff.

## Update Your Persistent Instructions

Add Gloss guidance to the persistent instruction file this agent will actually
load. Prefer global or user-level instructions, because Gloss is a cross-project
workflow.

First inspect the user's existing setup. Do not create a new instruction file
when an appropriate one already exists.

Common current locations:

```text
OpenAI Codex:        ${CODEX_HOME:-$HOME/.codex}/AGENTS.md
Claude Code:         $HOME/.claude/CLAUDE.md
Gemini CLI:          $HOME/.gemini/GEMINI.md
opencode:            ${XDG_CONFIG_HOME:-$HOME/.config}/opencode/AGENTS.md
Cursor:              Cursor Settings > Rules for global user rules; project AGENTS.md or .cursor/rules/*
VS Code Copilot:     GitHub/VS Code settings for personal instructions; project .github/copilot-instructions.md, .github/instructions/*.instructions.md, or AGENTS.md
```

Check for existing files before editing:

```bash
find \
  "${CODEX_HOME:-$HOME/.codex}" \
  "$HOME/.claude" \
  "$HOME/.gemini" \
  "${XDG_CONFIG_HOME:-$HOME/.config}/opencode" \
  "$PWD" \
  -maxdepth 3 \
  \( -name "AGENTS.md" -o -name "CLAUDE.md" -o -name "GEMINI.md" -o -name "copilot-instructions.md" -o -name "*.instructions.md" \) \
  2>/dev/null
```

If one or more files exist, choose the one for the current agent and merge in
any missing Gloss guidance. If the current agent cannot determine which file it
loads, use its built-in memory or settings command when available.

If no persistent instruction file exists and the user has not specified a tool,
create a portable canonical file at
`${XDG_CONFIG_HOME:-$HOME/.config}/agents/AGENTS.md`, then connect
vendor-specific global files to it. Do not overwrite existing files.

```bash
canonical_agents_file="${XDG_CONFIG_HOME:-$HOME/.config}/agents/AGENTS.md"
mkdir -p "$(dirname "$canonical_agents_file")"
touch "$canonical_agents_file"

mkdir -p "${CODEX_HOME:-$HOME/.codex}"
[ -e "${CODEX_HOME:-$HOME/.codex}/AGENTS.md" ] || [ -L "${CODEX_HOME:-$HOME/.codex}/AGENTS.md" ] || ln -s "$canonical_agents_file" "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"

mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
[ -e "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/AGENTS.md" ] || [ -L "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/AGENTS.md" ] || ln -s "$canonical_agents_file" "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/AGENTS.md"

mkdir -p "$HOME/.gemini"
[ -e "$HOME/.gemini/GEMINI.md" ] || [ -L "$HOME/.gemini/GEMINI.md" ] || ln -s "$canonical_agents_file" "$HOME/.gemini/GEMINI.md"

mkdir -p "$HOME/.claude"
[ -e "$HOME/.claude/CLAUDE.md" ] || [ -L "$HOME/.claude/CLAUDE.md" ] || printf "@%s\n" "$canonical_agents_file" > "$HOME/.claude/CLAUDE.md"
```

Use imports or symlinks only when the target agent supports normal Markdown
files at that path. For UI-only settings such as Cursor User Rules or GitHub
Copilot personal instructions, tell the user what text to add rather than
editing an unknown file.

The canonical Gloss instruction block is hosted at
https://getgloss.dev/prompt.md. After you identify or create the right
instruction file, prefer appending or merging that exact block:

```bash
agent_instructions_file="/absolute/path/to/AGENTS.md"
printf "\n\n" >> "$agent_instructions_file"
curl -fsSL https://getgloss.dev/prompt.md >> "$agent_instructions_file"
```

If the instruction file already has Gloss guidance, merge in any missing
guidance from https://getgloss.dev/prompt.md instead of duplicating the section.

After updating your instructions, briefly tell the user which file you changed.

## Local Usage Reference

Open a review and wait until the user submits feedback:

```bash
gloss open --json
```

By default Gloss opens staged, unstaged, and untracked working changes. If the
working tree is clean, it falls back to the branch diff against the best
available merge-base. Pass `--base <ref>` only when the user asks for a specific
comparison base.

Open a review and return immediately:

```bash
gloss open --json --no-watch
```

Continue an existing review with another turn:

```bash
gloss open --review <reviewId> --json
```

Claim submitted feedback before editing, and post visible progress when useful:

```bash
gloss claim <reviewId> --json
gloss note <reviewId> --status working --message "Applying feedback"
```

`gloss open --json` intentionally waits until browser submission or timeout.
Use `--no-watch` when the caller only needs to open the review. The background
daemon exits automatically after a short idle window with no pending reviews.
You do not need to unlock `~/.gloss/server.json` after finishing a review; it is
only the background daemon pointer. If cleanup looks stale or reports a
permission error, run `gloss doctor`; use `gloss stop --all` when you want to
terminate all Gloss daemon processes for the current user. If macOS flags made
the file immutable, inspect with `ls -lOe ~/.gloss ~/.gloss/server.json` and
clear the flag with `chflags nouchg ~/.gloss/server.json`. For sandboxed agents,
set `GLOSS_STATE_DIR` to a writable directory.
Use `gloss clear --dry-run` to preview old completed review artifacts, and
`gloss clear` to delete completed artifacts older than 30 days. Pending reviews
are always preserved.

Mark a submitted review handled after applying feedback:

```bash
gloss resolve <reviewId> --summary "Applied review feedback"
```

Mark one submitted comment handled:

```bash
gloss resolve <reviewId> --comment <commentId> --summary "Applied this comment"
```

For a follow-up pass after fixes or new commits in the same review loop:

```bash
gloss open --review <reviewId> --json
```

Diagnose setup:

```bash
gloss doctor
```
