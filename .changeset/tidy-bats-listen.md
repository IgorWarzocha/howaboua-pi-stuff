---
"@howaboua/pi-codex-conversion": patch
---

Add native Codex voice conversation and manually controlled dictation sessions, with configurable push/toggle shortcuts, persisted protocol, voice, and audio-device preferences, agent-guided device setup, cross-platform native capture and playback, Pi-agent delegation, themed session context, layered global and workspace realtime prompts, explicit lifecycle control, and a voice-only extension mode.

Stop active voice sessions immediately from `/codex voice stop`, even while the main agent is working.

Require Pi 0.82, keep voice-only mode from rewriting provider requests, honor provider proxy settings during realtime call setup, and validate native helper data and PCM events.

Recover cached Codex WebSocket sessions when the backend loses their previous-response continuation.

Clarify when shell commands need a TTY so long-running builds and tests remain interruptible.

Load native voice transports and command-only usage networking only when used.

Fix native web search on Windows by launching the bundled executable directly instead of spawning its command wrapper.

Keep Rust build sources out of the installed npm package while retaining native binaries and third-party notices.
