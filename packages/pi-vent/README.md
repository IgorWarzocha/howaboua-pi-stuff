# @howaboua/pi-vent

Adds an agent-callable `vent` tool for recording repeated or systemic workflow friction in the current workspace's `VENT.md`.

This package is no longer maintained. The workflow now lives as a Pi Codex custom tool. Clone and adapt this package if you need an independent extension.

Use it for recurring tool failures, repeated manual workarounds, noisy output that forces the same retries, or instructions that repeatedly cause backtracking. Ordinary lint errors, one-off mistakes, and routine debugging do not belong there.

Entries are batched near the end of an agent turn to avoid constant tool chatter.

## Tool

```ts
vent({
  thought: string,
  trigger?: string
})
```

- `thought` describes the failure, repeated workaround, and useful preventative fix.
- `trigger` is an optional short label such as `tool_error`, `bad_docs`, or `confusing_task`.

The extension creates `VENT.md` when needed and appends each note under a local timestamp:

```md
## 26-04-29 10:42 — tool_error

Symptom: a hook failed twice for the same generated artifact. Repeated workaround: deleted the artifact and reran the same command sequence. Suggested fix: add cleanup to the hook or document the generated-file lifecycle.
```
