---
"@howaboua/pi-codex-conversion-lite": minor
"@howaboua/pi-codex-conversion": patch
---

Add the lite Codex adapter with structured standard Responses tools, GPT-5.6 Responses Lite Code Mode, a routed and lazily loaded settings UI, shared config compatibility, native helpers, V2-only Responses compaction, and voice. Both Codex adapters now keep non-TTY foreground commands attached, back off yielded shell sessions for up to 30 minutes, preserve transport policy during compaction and voice-only use, decode bounded terminal output across byte and control-sequence boundaries, and install the Code Mode host in-process so standalone Pi binaries work on Windows. Lite remains excluded from aggregate bundles and preserves full-adapter fields in the shared config.
