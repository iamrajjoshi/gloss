---
name: gloss
description: Open local working-tree or branch changes in Gloss for browser review, wait for submitted feedback, and address returned comments. Use when the user asks to review local code changes, says "gloss this" or "open Gloss", wants to inspect a browser diff, or wants comments handled before a PR.
---

# Gloss

## Workflow

1. Run `gloss open --json` from the repo root unless the user names a base ref.
2. Leave the command running. It blocks until the browser review is submitted.
3. Parse the JSON output and read `feedbackPath` when present.
4. Address every comment in file and line order.
5. Validate the fix with the narrowest relevant checks.
6. If MCP tools are available, mark the review resolved after the fix. Otherwise summarize the feedback addressed and validation performed.

Feedback is stored under `~/.gloss/reviews/<reviewId>/`:

- `feedback.json` is the machine-readable handoff.
- `feedback.md` is the human-readable copy.
- `resolved.json` marks a completed review as handled.

Gloss opens staged, unstaged, and untracked working changes first. If the
working tree is clean, it falls back to the branch diff against the best
available merge-base. Use `--base <ref>` only when the user asks for a specific
comparison such as `origin/main`, `origin/master`, or `HEAD`.

If the user asks only to open the review and not wait, run
`gloss open --json --no-watch`.

For less-common options, run `gloss open --help` or `gloss --help` instead of
guessing flags.
