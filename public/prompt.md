## Gloss

Use Gloss when the user wants to review local code changes, inspect a multi-file
diff in a browser, or leave comments for an agent before a PR.

The user may say "gloss this", "open Gloss", "review my changes", "local diff
review", or "let me comment on the diff". Treat those as requests to use Gloss
when the current working tree has code changes.

From the repo root, open a blocking review with:

```bash
gloss open --json
```

Gloss opens staged, unstaged, and untracked working changes first. If the
working tree is clean, it falls back to the branch diff against the best
available merge-base. Use `--base <ref>` only when the user specifies a
comparison base such as `HEAD`, `origin/main`, or `origin/master`.

Leave the command running. Do not interrupt, kill, background, detach, or treat
the waiting process as cleanup. The wait is intentional: Gloss exits after the
user clicks Submit in the browser, and that exit is your signal to resume.

When `gloss open --json` exits, parse the JSON output. Prefer reading
`feedbackPath` from disk when present, because it contains the durable structured
feedback bundle. Check `feedback.reviewScope` before editing: missing or
`{ "mode": "all" }` means the whole turn was submitted; `{ "mode": "single" }`
or `{ "mode": "range" }` means the human submitted feedback while viewing only
that commit preview. Treat scoped feedback as comments on that slice, and do not
infer that unreviewed commits were approved. Address every comment in file/line
order, then run the narrowest relevant validation. After validation, run
`gloss resolve <reviewId> --summary "<what changed>"`.
When tracking progress comment-by-comment is useful, run
`gloss resolve <reviewId> --comment <commentId> --summary "<what changed>"`
after applying that specific comment.

If the user only wants a review URL and does not want you to wait, run:

```bash
gloss open --json --no-watch
```

If the user asks for another pass after fixes, commits, or additional changes,
continue the same review with `gloss open --review <reviewId> --json`.
The browser keeps one stable review URL; each follow-up is a new turn in the
same review history. Use a fresh `gloss open --json` only for unrelated work or
when the user explicitly wants a new review.

Gloss feedback is stored under:

```text
~/.gloss/reviews/<reviewId>/turns/<turnId>/feedback.json
~/.gloss/reviews/<reviewId>/turns/<turnId>/feedback.md
~/.gloss/reviews/<reviewId>/turns/<turnId>/resolved.json
```

Use `feedback.json` for structured agent work. Use `feedback.md` when a human
readable summary is useful. Use `resolved.json` as Gloss's mutable resolution
progress file; do not edit `feedback.json`.

Gloss is for code diffs. Do not use it for Markdown plan annotation; use
Roughdraft for Markdown review if the user has Roughdraft installed.

Useful commands:

```bash
gloss status --json
gloss watch <reviewId> --json
gloss open --review <reviewId> --json
gloss resolve <reviewId> --comment <commentId> --summary "Applied one comment"
gloss resolve <reviewId> --summary "Applied review feedback"
gloss doctor
```
