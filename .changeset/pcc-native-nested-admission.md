---
"@howaboua/pi-codex-conversion": patch
---

Fixed PCC's native Code and Notebook tools to use Pi's tool admission hooks. The nested catalogue follows Pi's callable selection, and stale names no longer bypass it. PCC preflight and completion hooks still run for these tools. An in-flight Pi call can delay an outer yield until the call settles.

Older Code sessions whose saved selection could not record PCC's nested tools regain the default nested tools. Deliberate selections, including an empty nested selection, are preserved.

Update Codex Guardian alongside PCC to avoid duplicate reviews of these nested calls.
