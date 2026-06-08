---
"@howaboua/pi-codex-conversion": patch
---

Routes `web_run` through the Rust path tool only, removes the TypeScript fetch fallback and browser-style Cloudflare cookie handling, preserves explicit alpha search URLs, and registers Codex-native OAuth scopes required by alpha search, and adds `/codex login` for re-authenticating with those scopes.
