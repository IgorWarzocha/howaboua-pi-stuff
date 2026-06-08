---
"@howaboua/pi-codex-conversion": patch
---

Routes `web_run` through the Rust path tool only, removes the TypeScript fetch fallback and browser-style Cloudflare cookie handling, registers Codex-native OAuth scopes, adds `/codex login`, uses Codex Responses web search for standalone results, returns `search_results` citation records, and adds persisted `open`/`click`/`find` follow-up refs. Updates the vendored Codex `apply_patch` source and Linux binary to the pinned Codex revision in `vendor/apply-patch-src/UPSTREAM`, routes Pi's `apply_patch` tool through the Rust patcher with structured JSON deltas for Pi UI rendering, routes Pi's `view_image` and `imagegen` tools through the Rust path binaries while keeping TypeScript as Pi glue, removes the stale TypeScript patch executor, centralizes bundled binary execution for Pi tool shims, and stages a Rust `codex-exec-shim` crate from Codex's PTY/process substrate for the exec/write_stdin migration.
