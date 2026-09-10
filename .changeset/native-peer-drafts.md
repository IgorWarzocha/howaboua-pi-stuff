---
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-codex-conversion": patch
---

Deliver peer messages directly to Pi without submitting unsent human drafts.

- Preserve slash-command arguments and use the target session's skill and prompt-template expansion.
- Return submission-only acknowledgements for registered extension commands instead of waiting for an assistant reply.

Requires Pi 0.84.4 or newer. Update and reload Shepherdr on both controllers and workers, and Pi Codex Conversion where installed.
