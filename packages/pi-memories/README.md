# pi-memories

A tiny Pi extension that writes memory candidates when Pi exits.

pi-memories expects you to use Pi's global `AGENTS.md` as your long-term memory file. If you do not have one yet, see [Recommended AGENTS.md setup](#recommended-agentsmd-setup).

It does not try to maintain a database, vector store, or hidden profile. It runs one short, no-tools/no-skills Pi session after shutdown, asks for a few durable things worth remembering, and appends the result to a plain markdown inbox.

You review the inbox later and decide what, if anything, belongs in `AGENTS.md`.

## How it works

On an actual Pi shutdown (`session_shutdown` with reason `quit`), pi-memories collects the best context it can find. Reloading, switching, creating, or forking sessions does not run the memory worker.

1. OpenAI native compaction blob, if the session has one.
2. Normal Pi compaction summary, if the session has one.
3. Recent conversation tail, if there is no compaction.

Then it starts an ephemeral Pi run with:

```txt
--no-session --no-skills --no-tools
```

That run still gets your normal Pi context files, so global/project `AGENTS.md` can help it decide what is actually new. The output is appended to:

```txt
~/.pi/agent/memory-inbox.md
```

Short no-compaction sessions are skipped by default, so opening Pi for one quick question should not create memory noise.

## Install

Clone or install this package, then add it to your Pi packages list.

For a local checkout:

```json
{
  "packages": [
    "/path/to/pi-memories"
  ]
}
```

Pi will load the extension from the package manifest.

## Config

The extension creates this file on first load:

```txt
~/.pi/agent/pi-memories.json
```

Edit it if you want to change the defaults.

Example:

```json
{
  "enabled": true,
  "model": "openai-codex/gpt-5.4-mini",
  "thinking": "low",
  "inboxPath": "/home/you/.pi/agent/memory-inbox.md",
  "timeoutMs": 120000,
  "includeProjectContext": true,
  "minUserMessagesWithoutBlob": 3
}
```

### Options

| Option | Default | What it does |
|---|---:|---|
| `enabled` | `true` | Turn the extension on/off. |
| `model` | `gpt-5.4` | Model used for the shutdown memory pass. |
| `thinking` | `low` | Thinking level for the memory pass. Use `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. |
| `inboxPath` | `~/.pi/agent/memory-inbox.md` | Where memory candidates are appended. |
| `timeoutMs` | `120000` | Max time to wait for the ephemeral Pi run. |
| `includeProjectContext` | `true` | Keep project `AGENTS.md` / `CLAUDE.md` context. Set false to use only the explicit memory prompt. |
| `minUserMessagesWithoutBlob` | `3` | If there is no compaction, skip sessions with fewer user messages than this. |

## Recommended AGENTS.md setup

pi-memories is designed around Pi's global `AGENTS.md`. It can still append candidates to the inbox without one, but `/memory-review` is meant to promote useful memories into this file.

Pi loads global instructions from:

```txt
~/.pi/agent/AGENTS.md
```

The shutdown worker receives those instructions too. That means it can use your existing preferences when deciding what belongs in the inbox, and `/memory-review` can use them when deciding what to promote.

A starter section is included here:

```txt
templates/AGENTS.memory-template.md
```

Copy the parts you like into your global `AGENTS.md`. Keep it short. The inbox is allowed to be messy; `AGENTS.md` should not be.

## Review memories

Run:

```txt
/memory-review
```

This fills the editor with a prompt to review `memory-inbox.md` and promote only the useful bits into global or project `AGENTS.md`.

The review step is intentionally manual. The inbox can have duplicates. That is fine. The point is to avoid silently poisoning your long-term instructions.

## Notes

- The shutdown worker runs without tools and without skills.
- It uses existing compaction context when available, but does not store compaction blobs.
- If `pi-codex-conversion` native compaction is present, the opaque OpenAI blob is used only for that one ephemeral run.
- If there is no compaction, the extension falls back to conversation text and applies the short-session gate.
