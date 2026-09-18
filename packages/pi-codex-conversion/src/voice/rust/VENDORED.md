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

Sonora `0.2.0` and Rubato `5.0.0` are registry dependencies rather than
vendored source. Both are pinned in `Cargo.toml` and `Cargo.lock`.
Their binary-distribution notices and those of the introduced transitive
dependencies are in `vendor/rust-dependencies/`.
