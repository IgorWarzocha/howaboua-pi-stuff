---
"@howaboua/pi-codex-conversion": patch
---

Routes `web_run` through the Rust path tool only, removes the TypeScript fetch fallback and browser-style Cloudflare cookie handling, registers Codex-native OAuth scopes, adds `/codex login`, and uses the Codex Responses web-search endpoint for standalone search results.
