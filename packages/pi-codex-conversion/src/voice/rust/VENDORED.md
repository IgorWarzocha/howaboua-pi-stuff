# Vendored native audio code

`src/codex_audio/buffers.rs` and `src/codex_audio/processing.rs` are adapted
from `codex-rs/voice-host/src/device_buffers.rs` and
`codex-rs/voice-host/src/processing.rs` in
<https://github.com/openai/codex> at commit
`7498521d288b9b3b96ffba4eedf089d8d6e06a84`.

The adaptations retain Codex's callback frame boundaries, capture-generation
isolation, Rubato streaming conversion, and Sonora echo, noise, and gain
processing. Integration with this helper's CPAL devices, WebRTC track, IPC,
and bridge mode remains local to this crate. The copied code is licensed under
Apache-2.0. Its license and notice are in `vendor/openai-codex/`.

Sonora `0.2.0` and Rubato `5.0.1` are registry dependencies rather than
vendored source. Both are pinned in `Cargo.toml` and `Cargo.lock`.
Their binary-distribution notices and those of the introduced transitive
dependencies are in `vendor/rust-dependencies/`.

The local WebRTC integration uses `webrtc` and its `rtc` core at `0.21.1`.
`v3_events.rs` adapts driver callbacks and polled data-channel events to the
existing JSONL protocol. `v3_media.rs` adapts negotiated RTP sender parameters
and remote track events. Session shutdown cancels and joins these workers
before closing the peer. These are local integration changes, not a newer
Codex source import.

Opus `0.4.0` uses `opusic-sys` `0.7.6`, which builds its packaged libopus
`1.6.1` source with CMake and links it statically. No downloaded codec binary
or host-library override is required. The wrapper and bundled codec notices
are included in `vendor/rust-dependencies/`.
