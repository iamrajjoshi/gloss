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
feedback bundle. Address every comment in file/line order, then run the
narrowest relevant validation.

If the user only wants a review URL and does not want you to wait, run:

```bash
gloss open --json --no-watch
```

Gloss feedback is stored under:

```text
~/.gloss/reviews/<reviewId>/feedback.json
~/.gloss/reviews/<reviewId>/feedback.md
```

Use `feedback.json` for structured agent work. Use `feedback.md` when a human
readable summary is useful.

Gloss is for code diffs. Do not use it for Markdown plan annotation; use
Roughdraft for Markdown review if the user has Roughdraft installed.

Useful commands:

```bash
gloss status --json
gloss watch <reviewId> --json
gloss doctor
gloss mcp
```

The MCP server exposes tools to list pending reviews, fetch review details,
watch for completion, read feedback, and mark a review resolved.
