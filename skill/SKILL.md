---
name: gloss
description: Open local working-tree or branch changes in Gloss for browser review, wait for submitted feedback, and address returned comments or discuss them before editing. Use when the user asks to review local code changes, says "gloss this" or "open Gloss", wants to inspect a browser diff, wants comments handled before a PR, or asks to discuss/propose feedback fixes first.
---

# Gloss

## Workflow

1. Run `gloss open --json` from the repo root unless the user names a base ref.
2. Leave the command running. It blocks until the browser review is submitted.
3. Parse the JSON output and read `feedbackPath` when present.
4. Decide the mode (see "Discussion Mode" below). Default is apply-directly.
5. Address every comment in file and line order, or per the discussion plan.
6. Validate the fix with the narrowest relevant checks.
7. When useful, run `gloss resolve <reviewId> --comment <commentId> --summary "<what changed>"` as each comment is handled.
8. Run `gloss resolve <reviewId> --summary "<what changed>"`, then summarize the feedback addressed and validation performed.

## Discussion Mode

Some feedback is ambiguous, opinionated, or wide-reaching enough that the right
move is to talk through it before editing code. Enter discussion mode when any
of these are true:

- The user asked for it before running gloss — phrases like "discuss first",
  "talk through it", "don't apply yet", "let's discuss", "review the comments
  with me", or "propose first".
- A comment is genuinely ambiguous and you'd otherwise have to guess intent.

When in discussion mode:

1. Read every comment in `feedback.json` first. Do not edit any files yet.
2. Group comments by file. For each, restate the comment in one line and
   propose how you'd address it — the approach plus the lines that would
   change. Flag any that conflict, are out of scope, or need a decision.
3. Ask the user which to apply, modify, or skip. Wait for an answer.
4. Apply only what's approved. Skip or defer the rest, and note skipped items
   in the resolution summary so they aren't silently dropped.
5. Validate, then resolve as usual.

Default (no discussion request and no ambiguous comments): the current
apply-directly workflow.

Feedback is stored under `~/.gloss/reviews/<reviewId>/`:

- `feedback.json` is the machine-readable handoff.
- `feedback.md` is the human-readable copy.
- `resolved.json` tracks mutable comment-level and review-level resolution progress.

Gloss opens staged, unstaged, and untracked working changes first. If the
working tree is clean, it falls back to the branch diff against the best
available merge-base. Use `--base <ref>` only when the user asks for a specific
comparison such as `origin/main`, `origin/master`, or `HEAD`.

If the user asks only to open the review and not wait, run
`gloss open --json --no-watch`.

`gloss open --json` intentionally stays alive until the browser review is
submitted or the watch timeout expires. If a long-running `gloss open` looks
unexpected, first check whether it is waiting on an active browser review
before killing processes.

The background daemon shuts down on its own after a short idle window with no
pending reviews. If process cleanup still looks stale, run `gloss doctor` to
report unmanaged daemons. Use `gloss stop --all` only when intentionally
cleaning up all Gloss daemon processes for the current user.

If the user asks for a follow-up review after fixes, commits, or additional
changes, run a fresh `gloss open --json` session instead of reusing the old
review.

For less-common options, run `gloss open --help` or `gloss --help` instead of
guessing flags.
