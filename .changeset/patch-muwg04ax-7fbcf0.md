---
"@howaboua/pi-codex-guardian": patch
---

Initial release of Codex Guardian approval reviews for Pi.

- Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
- AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
- Use `/guardian` to inspect status, enable or disable protection, and reload rules.

Installed separately from the extension bundles. Review requests are not confirmed to be free.
