---
name: gloss
description: Open local code changes in Gloss for browser review, wait for feedback, and address the returned comments.
---

# Gloss

Use this skill when the user asks to review local code changes with Gloss, says
"gloss this", "open gloss", "review my changes", or wants a browser-based local
diff review before a PR.

## Workflow

1. Run `gloss open --json --base ${base:-HEAD}` from the repo root.
2. Wait for the command to exit. It blocks until the browser review is submitted.
3. Parse the JSON output and read `feedbackPath` if present.
4. Address each comment in order by file and line.
5. Validate the fix with the narrowest relevant tests or build.
6. Summarize the comments addressed and the validation performed.

If the user asks only to open the review and not wait, run
`gloss open --json --no-watch`.
