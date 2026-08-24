# @howaboua/pi-subdir-agents

Loads nested `AGENTS.md` files only when an agent reaches their directories during repository discovery.

It keeps Pi's base system prompt stable. Instead of injecting nested guidance eagerly or rewriting earlier context, it appends the relevant `AGENTS.md` chain to the discovery tool result that reached that directory.

## Install

```bash
pi install npm:@howaboua/pi-subdir-agents
```

## How it works

When a read or discovery command reaches a file or directory, the extension finds every nested `AGENTS.md` between that target and its repository root. It appends those files to the tool result in outer-to-inner order.

The loader recognizes direct file reads, directory tools, common read-oriented shell commands, their reported paths, and completed Code Mode traces. It follows the discovered command working directory, including `cd` and `git -C`.

Loaded files are persisted in tool-result details. A resumed or revisited branch does not receive unchanged guidance again. The extension periodically refreshes the visible appendix without rewriting persisted history.

## Why tool results instead of the system prompt

Nested guidance is variable. Loading it into Pi's system prompt would change an early provider-rendered prefix whenever the agent enters another directory. This extension leaves that prefix alone and appends new guidance at the point where the agent discovered the directory.

That keeps the stable system prompt, tools, and earlier history intact for provider prompt caching. It does not guarantee a cache hit. Provider cache reuse still depends on the model, request lane, and final rendered request.

## What it does not do

- It does not preload every `AGENTS.md` in a repository.
- It does not duplicate the current working directory's base guidance.
- It does not mutate Pi's system prompt, rewrite earlier messages, or add a model tool.
- It does not inspect arbitrary shell commands. It reacts only to commands that plausibly discover or read paths.

## Markdown Workflows

Do not install this package beside the current `pi-markdown-workflows` release. That package still registers the same loader until its planned deprecation.

This package is intentionally standalone until that transition. It is not included in `@howaboua/pi-extensions` or `@howaboua/pi-stuff` yet.
