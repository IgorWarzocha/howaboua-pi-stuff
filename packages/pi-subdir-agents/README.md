# @howaboua/pi-subdir-agents

Loads nested `AGENTS.md` files when an agent reaches their directories during repository discovery.

## Install

`pi install npm:@howaboua/pi-subdir-agents`

The extension discovers nested guidance from file reads and common directory or shell discovery commands. It appends the relevant ancestor chain to that tool result, persists it across session resume, and does not preload unrelated directories.

Do not install it beside the current `pi-markdown-workflows` release. That package still registers the same loader until its planned deprecation.
