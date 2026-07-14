# @howaboua/pi-memories

Writes a small set of memory candidates when Pi exits, then leaves the final decision to you. There is no database, vector store, or hidden profile: candidates go to a plain Markdown inbox for manual review.

## Install

```bash
pi install npm:@howaboua/pi-memories
```

## How it works

The worker runs only for a real Pi shutdown (`session_shutdown` with reason `quit`), not reloads, new sessions, resumes, or forks. It uses the best context available:

1. an OpenAI native compaction window
2. a normal Pi compaction summary
3. the recent conversation when no compaction exists

It starts an ephemeral Pi process with `--no-session --no-skills --no-tools`. Normal context files remain available unless disabled in config, which lets the worker compare candidates with existing global and project instructions.

Candidates are appended to `~/.pi/agent/memory-inbox.md`. Short sessions without compaction are skipped by default, and output equal to `No durable memories.` is not written.

## Review

Run `/memory-review`. The command fills the editor with a review prompt that asks the agent to promote only durable, non-sensitive information into the appropriate global or project `AGENTS.md`, merge duplicates, and empty the inbox when finished.

The review is deliberately manual. Inbox entries are candidates, not truth.

## Configuration

The extension creates `~/.pi/agent/pi-memories.json` on first load.

| Option | Default | Purpose |
|---|---|---|
| `enabled` | `true` | Enable shutdown distillation. |
| `model` | `gpt-5.4` | Model passed to the ephemeral Pi process. |
| `thinking` | `low` | Thinking level, from `off` through `max`. |
| `inboxPath` | `~/.pi/agent/memory-inbox.md` | Destination for candidates and failure comments. |
| `prompt` | built-in distillation prompt | Replace the worker prompt. |
| `timeoutMs` | `120000` | Maximum worker runtime. |
| `includeProjectContext` | `true` | Include Pi's normal context files; `false` passes `--no-context-files`. |
| `minUserMessagesWithoutBlob` | `3` | Skip shorter sessions when no compaction exists. |

Use a provider/model string available in your Pi setup when overriding `model`.
