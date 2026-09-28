---
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-codex-imagegen": patch
"@howaboua/pi-codex-web-run": patch
---

Codex tools now support explicit image transparency and more reliable requests.

- Retries now honor server deadlines within the three-minute recovery limit. Flex capacity failures stop without futile retries.
- Ready WebSocket connections now skip redundant warmup requests.
- Web search and image generation now re-evaluate proxy and `no_proxy` routing after redirects.
- Added `transparent_background` for generated and edited images; omitted or false requests an opaque background.
