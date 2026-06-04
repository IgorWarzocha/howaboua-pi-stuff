---
"@howaboua/pi-skill-model-facing-api-design": patch
"@howaboua/pi-codex-conversion": patch
---

Add the model-facing-api-design skill package.

Fix Codex context budget adjustment so starting fresh sessions does not recursively shrink a reused model's displayed context window.

Add a Proxy tools override for proxied providers, enabled by default, so Codex proxy users can choose whether listed providers receive native web search, image generation, and fast mode.
