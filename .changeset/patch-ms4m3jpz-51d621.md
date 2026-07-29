---
"@howaboua/pi-codex-conversion-lite": patch
---

Serve session-scoped Codex voice, editable dictation drafts, and Pi activity from the themed GipPity LAN remote with seamless audio takeover between devices. Add a configurable control-server shortcut and remove obsolete V2 conversation settings; realtime voice always uses V3 while dictation remains a separate action. Keep retries on WebSocket after mid-stream disconnects, preserve the active provider prompt during V2 compaction so prompt caches remain hot, and reconcile tool calls with their outputs after every history rewrite. Refresh the disabled Herdr example and add a categorized lazy skill loader alongside the existing additive loader. Mark this as the final Lite release and direct interactive users to the canonical package on startup.
