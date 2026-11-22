---
"@howaboua/pi-better-skills-tool": patch
---

- Skills lists and deduplicates trusted repository `.agents/skills` alongside `.pi/skills`, including when Pi has no loaded skills. It excludes global `~/.agents/skills`.
- Skills always uses compact discovery and reading guidance, including in standalone installs.
