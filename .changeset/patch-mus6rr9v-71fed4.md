---
"@howaboua/pi-better-skills-tool": patch
---

Better Skills now hides the skill catalog from Pi, Code Mode, and Notebook Mode prompts while preserving native `/skill:<name>` commands.

Remove `--no-skills` from launch wrappers or aliases. Separate catalog-clearing hooks are no longer needed.
