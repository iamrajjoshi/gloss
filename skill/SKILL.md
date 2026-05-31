---
name: gloss
description: Open local working-tree or branch changes in Gloss for browser review, wait for submitted feedback, continue existing reviews with new turns, inspect Gloss status/state, and address returned comments or discuss them before editing. Use when the user asks to review local code changes, says "gloss this" or "open Gloss", wants to inspect a browser diff, wants comments handled before a PR, asks for a follow-up review pass, asks to find Gloss review state/artifacts, or asks to discuss/propose feedback fixes first.
---

# Gloss

## Workflow

1. From the repo root, run `gloss open --json` unless the user names a base ref.
2. Leave it running; it waits until browser submission. Use `--no-watch` only when the user only wants the review opened.
3. Parse the JSON output and read `feedbackPath`.
4. Apply feedback in file/line order unless "Discussion Mode" applies.
5. Validate with the narrowest relevant checks.
6. Resolve handled feedback with `gloss resolve <reviewId> --comment <commentId> --summary "<what changed>"` when useful, then `gloss resolve <reviewId> --summary "<what changed>"`.
7. For another pass on the same work, run `gloss open --review <reviewId> --json`; use a fresh `gloss open --json` only for unrelated work.

## Discussion Mode

Enter discussion mode when the user asks to discuss/propose first, or when a
comment is too ambiguous to apply safely. Trigger phrases include "discuss
first", "talk through it", "don't apply yet", "review the comments with me",
and "propose first".

When discussing:

1. Read every comment in `feedback.json` before editing. Do not edit files yet.
2. Group comments by file. Restate each comment in one line, propose the change, and flag conflicts/out-of-scope items.
3. Ask which items to apply, modify, or skip, then wait for the answer.
4. Apply only approved items, validate, then resolve as usual. Mention skipped items in the resolution summary.

Default when the user did not request discussion and comments are clear:
apply feedback directly.

## Feedback Scope

Check `feedback.reviewScope` before editing:

- Missing or `{ "mode": "all" }`: feedback covers the whole turn.
- `{ "mode": "single", "sha": "..." }`: feedback covers one commit preview.
- `{ "mode": "range", "fromSha": "...", "toSha": "..." }`: feedback covers a contiguous commit range.

Treat scoped feedback as comments on that submitted slice; do not infer that
unreviewed commits were approved.

## State And Artifacts

For existing loops, run `gloss status --json` first; it reports daemon state and
active review metadata. If the daemon is down or the review ID is missing,
inspect durable state under `${GLOSS_STATE_DIR:-$HOME/.gloss}`:

- `server.json`: daemon pid, port, version, and state dir.
- `reviews/<reviewId>/meta.json`: review status, cwd, active turn, and turn summaries.
- `reviews/<reviewId>/turns/<turnId>/`: `turn.json`, `diff.json`, `feedback.json`, `feedback.md`, `resolved.json`.

Use this pattern to discover review files:

```bash
state_dir="${GLOSS_STATE_DIR:-$HOME/.gloss}"
find "$state_dir/reviews" -maxdepth 4 -type f
```

The same browser URL stays open for each review loop. Historical turns are
read-only.

Gloss opens staged, unstaged, and untracked working changes first. If the
working tree is clean, it falls back to the branch diff against the best
available merge-base. Use `--base <ref>` only when the user asks for a specific
comparison such as `origin/main`, `origin/master`, or `HEAD`.

`gloss open --json` intentionally stays alive until the browser review is
submitted or times out. If it looks stuck, check whether it is waiting on an
active browser review before killing processes.

The background daemon shuts down on its own after a short idle window with no
pending reviews. Use `gloss doctor` for stale process cleanup diagnostics,
`gloss stop --all` only for intentional daemon cleanup, and
`gloss clear --dry-run` before deleting completed artifacts older than 30 days
with `gloss clear`. Pending reviews are always preserved.

For less-common options, run `gloss open --help` or `gloss --help` instead of
guessing flags.
