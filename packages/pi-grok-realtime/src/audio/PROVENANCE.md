# Local audio helper

The standalone Rust helper uses [CPAL 0.18.2](https://github.com/RustAudio/cpal)
for device discovery and I/O, and [Sonora 0.2.0](https://github.com/dignifiedquire/sonora)
for echo cancellation and noise suppression. Dependencies are pinned in
`rust/Cargo.toml` and resolved in `rust/Cargo.lock`. No third-party source is copied here.
CPAL is Apache-2.0 licensed. Sonora and its WebRTC-derived DSP use BSD-3-Clause.
Each binary is accompanied by dependency notices in `LICENSES.txt`, generated
from its Cargo dependency graph during the build. For `dasp_sample`, the build
selects its Apache-2.0 option. Sonora's workspace license also covers `sonora-aec3`.
The objc2 crates omit their workspace notice from published archives; the build
includes the upstream notice retained in `scripts/licenses/objc2.md`.

The default backends are ALSA on Linux, CoreAudio on macOS and WASAPI on Windows.
Discovery and stream selection use the same backend and CPAL device IDs.
Device formats and channel counts are converted to mono float samples locally.
Streaming linear interpolation feeds 48 kHz, 10 ms Sonora frames. Processed
capture is pair-averaged to 24 kHz and emitted as 20 ms signed i16 LE frames.
This is a simple voice-rate converter, not a high-fidelity band-limited resampler.
Echo processing receives the quantized samples submitted to the output device,
including silence, rather than PCM waiting in the network or playback queue.
Capture and playback timestamps supply the echo-delay estimate.

IPC uses a one-byte tag and uint32 little-endian payload length. Queues grow
as needed; the representation boundary is not a total audio limit. Drain waits
until an output callback's stream clock reaches the final sample's playback
timestamp. Additional PCM extends a pending drain. Clear drops and recreates
the output stream because CPAL has no portable flush operation, and resets
the echo reference. Mute epochs and capture timestamps exclude buffered audio
from before a toggle. Explicit stop terminates the helper process.

Build with `bun run build:audio-helper` from the package. Rust and the platform
compiler toolchain are required; Linux additionally needs `pkg-config` and ALSA
headers. macOS builds embed the microphone usage description in the executable's
`__TEXT,__info_plist` section, following Apple's command-line
[Info.plist support](https://developer.apple.com/documentation/xcode/build-settings-reference).
This does not establish how every terminal host is attributed by macOS privacy
controls. The helper is not sandboxed, signed with a developer identity or notarized.

The audio workflow builds x64 and ARM64 binaries on each target OS and runs
`--check`, which exercises protocol and DSP without opening audio devices.
Release verification requires all six binaries. Neither build success nor
`--check` establishes microphone permission behavior, device compatibility,
echo quality or glitch-free playback. Those require real-device validation.
No credentials or provider transport enter the helper.
