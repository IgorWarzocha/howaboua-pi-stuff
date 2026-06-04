---
"@howaboua/pi-codex-conversion": patch
---

Match Codex background terminal polling by allowing empty `write_stdin` waits to use a dedicated 5-minute cap instead of the normal 30-second exec cap.
