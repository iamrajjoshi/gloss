---
name: gloss
description: Open local working-tree or branch changes in Gloss for browser review, wait for feedback, and address returned comments. Use when the user asks to review local code changes, open Gloss, inspect a browser diff, or comment on a diff before a PR.
---

# Gloss

## Workflow

1. Run `gloss open --json` from the repo root unless the user names a base ref.
2. Wait for the command to exit. It blocks until the browser review is submitted.
3. Parse the JSON output and read `feedbackPath` if present.
4. Address each comment in order by file and line.
5. Validate the fix with the narrowest relevant tests or build.
6. Summarize the comments addressed and the validation performed.

Gloss opens staged, unstaged, and untracked working changes first. If the
working tree is clean, it falls back to the branch diff against the best
available merge-base. Use `--base <ref>` only when the user asks for a specific
comparison such as `origin/main`, `origin/master`, or `HEAD`.

If you need less-common options, run `gloss open --help` for command-specific
flags or `gloss --help` for the top-level command list instead of guessing
parameters.

If the user asks only to open the review and not wait, run
`gloss open --json --no-watch`.
