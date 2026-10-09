---
"@howaboua/pi-codex-conversion": patch
---

**BREAKING CHANGE:** Requires Pi 1.1.0 or newer. Update Pi before updating Codex Conversion.

Cancelled runs no longer trigger notes checkpoint rollover, qualify for the 25-minute idle rollover, or receive a Notes saved marker when cancellation follows the final reply.

Note-save bookmarks now mark the next user prompt as Notes. Selecting it in /tree restores the prompt to the editor at the saved-notes checkpoint.
