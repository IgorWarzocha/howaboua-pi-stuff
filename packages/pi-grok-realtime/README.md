# Grok Realtime

Talk with Grok while your current Pi agent does the work. Use your computer's microphone or a phone browser on your LAN. Pi keeps its model, tools and working environment, and its progress and replies flow back into the conversation.

- Delegate tasks by voice and keep talking while Pi works.
- Dictate into an editable draft without automatically sending it.
- Control calls from a Pi-themed browser page with live Pi activity.
- Add personality through Markdown and extend voice with your own tools.

## Account access

Choose OAuth or API key in settings. OAuth is the default. The selection must match the active xAI credential configured in Pi; an unavailable choice fails before saving and leaves the previous setting unchanged. Pi exposes its active credential, so this selector does not switch between two separately stored credentials. Access is checked again when voice or dictation starts, without falling back to another type.

Configure credentials in Pi, not this extension. Credentials stay in the host process and are never sent to the browser or audio helper. Voice quota and billing attribution depend on your account and are not established by this extension.

## Use

Requires Pi 1.0.0 or newer and Node.js 22.19 or newer. Local audio targets Linux, macOS and Windows on x64 and ARM64. Browser audio is independent of the local helper.

```sh
pi install npm:@howaboua/pi-grok-realtime
```

Run `/reload`, then `/grok` to choose settings. Start with `/grok local`, or `/grok server` to open browser control. Loading the extension does not connect voice or start a server.

- `/grok` opens tabbed settings for Voice, Context and Tools. Audio devices groups the microphone and speaker pickers. Use Tab or Shift+Tab to switch sections; Help contains usage, prompt paths and billing information. Settings apply to the next call; use `/reload` after changing shortcuts.
- `/grok local` starts local microphone and speakers.
- `/grok server` toggles browser control. Accept the local HTTPS certificate before granting microphone access.
- `/grok dictate` starts dictation. Run it again to finish into Pi's editor, where you can edit before sending. `/grok cancel` discards the active dictation.
- `/grok mute` toggles microphone mute while keeping the call connected.
- `/grok stop` stops voice and browser control.

Ctrl+Alt+V toggles voice; Ctrl+Alt+T toggles dictation. Change or disable either shortcut in settings.

The browser supports voice, dictation into an editable draft, mute, typed Pi requests and next-call settings. It shows Pi's current response, working state and terminal prompt titles, using Pi's theme. Phone home-screen metadata and icons are included. Browser disconnects and device takeover preserve the host call. Stop ends it. Voice and dictation share one microphone owner across local and browser audio, so starting one replaces the other. Switching Pi sessions shuts both down. A spoken parting can end the call after the farewell finishes playing. Interrupting the farewell keeps the call open.

Browser microphone audio captured during connection setup is buffered. Call status shows when Pi is working, and tool continuations wait for the preceding speech to finish playing. The browser warns about a quiet microphone or paused audio. Use Resume audio if playback is blocked, or Silence speaker to suppress playback without muting your microphone.

LAN control is unauthenticated and intended only for trusted networks. Browser control and audio enforce the same HTTPS origin. Do not expose it to the internet.

With Shepherdr running in both sessions, ask Pi to put you through to another session. The call keeps its original microphone and speakers while the destination Grok greets you with its own session context. Each transfer switches between the destination's primary and alternate voices, including transfers back. Grok transfers require Grok at the destination. Text-only focus remains available for other sessions.

## Settings and recovery

Settings live in `grok-realtime.json` in Pi's agent directory. The default LAN port is `43121`. The default primary voice is `eve`, alternate voice is `ara` and model is `grok-voice-latest`.

Automatic resume is on by default. A dropped voice connection gets one replacement attempt, preserving the audio device, mute state and conversation continuity. If recovery fails, the call stops with an error. Browser microphone disconnection is separate; reconnect from the page. Dictation failures retain available partial text but do not resume transcription automatically.

Dictation uses xAI's streaming speech-to-text service with your Pi xAI login, not the realtime conversation model. It does not invoke tools or submit a Pi request. Like Grok Build, it sends 16 kHz mono audio with 400 ms endpointing. The language setting controls text normalization; `auto` resolves the host's locale, falling back to English when unsupported. Transcription has its own pricing or account allowance. Account entitlement and billing still need to be verified separately.

## Personality and context

Add voice personality and guidance in `~/.pi/agent/GROK-REALTIME-SYSTEM-PROMPT.md`, or in Pi's configured agent directory. The first call creates a comment-only template if the file is missing and never overwrites an existing file. Optional project instructions live in `.pi/GROK-REALTIME-SYSTEM-PROMPT.md` under the session's working directory.

Each new call uses the built-in prompt, then global instructions, then project instructions. HTML comments are stripped; malformed comments stop startup visibly. Empty files leave the built-in prompt unchanged. These additions do not alter Pi's system prompt, the context summarizer or GipPity's `REALTIME-SYSTEM-PROMPT.md`. Voice instructions appear in saved session diagnostics.

Before connecting, a separate model call summarizes the current conversation for voice continuity. Context model defaults to the current Pi model; choose another available model or `off` in settings. Context reasoning defaults to `high` and does not change Pi's reasoning setting. This summary call uses the selected model's account and may consume its quota or incur its normal charges. The exact summary is saved in a Grok voice context entry. Voice also refreshes its summary after Pi compaction without restarting the call. Unreadable native compaction checkpoints fail visibly rather than producing an incomplete summary.

Voice transcripts appear in separate Grok voice boxes. Call diagnostics are saved alongside Pi's session history, including forwarded Pi text, response events, interruptions, playback drain acknowledgements and provider errors. They contain no credentials or raw audio. A transcript records generated speech, not proof that every word was heard. Playback diagnostics distinguish a completed drain from an interrupted one.

The voice chooser includes 28 Grok Bot voice IDs and accepts custom IDs. Model choices include `grok-voice-latest` and `grok-voice-think-fast-2.0`, with custom IDs allowed. Availability depends on the selected account. Speech speed offers Grok Bot's presets from `0.5` to `2` and accepts custom values. The public realtime API documents `0.7` to `1.5`; values outside that range may be rejected by the provider. Language defaults to automatic detection and accepts tags such as `en-US`. Silence follow-up is off by default; when enabled, it uses the provider's silence timer only while Pi is idle and the microphone is unmuted. The timer switches during the call as Pi starts and settles. Changed settings require a new call.

## Extend voice tools

Extensions can register typed local functions with `registerGrokTool` from `@howaboua/pi-grok-realtime/tools`. Grok sees the tool's name, description and argument schema; its handler runs on the Pi host. Registered tools appear in the Tools tab. After changing an extension, use `/reload` and start a new call. Installing an extension grants its code host access, and the extension owns approvals for consequential actions.

See the [tool development guide](docs/tools.md) and [runnable local-tool example](examples/local-tool.ts). These tools belong to Grok voice, not Pi's model tool list.

Enable Web search in settings to let xAI search directly during voice conversations. It is off by default, bypasses Pi's research workflow and may incur additional provider tool charges.

## Local audio

Local device discovery, microphone capture and speaker playback use the same cross-platform audio helper: ALSA on Linux, CoreAudio on macOS and WASAPI on Windows. Linux needs the ALSA runtime and a configured sound device or sound-server ALSA plugin. Allow microphone access when your operating system asks.

On macOS, microphone permission may be attributed to the terminal application hosting Pi. Check System Settings → Privacy & Security → Microphone if capture is denied. On Windows, check Privacy & security → Microphone, including access for desktop apps. Managed-device policy can also block capture. The macOS helper includes a microphone usage description, but permission prompts across terminal hosts still need validation.

Choose a microphone and speaker under Voice → Audio devices, or use system defaults. Browser audio uses the browser's selected devices.

Build the helper from this package with `bun run build:audio-helper`. Building requires Rust and the platform's compiler toolchain; Linux also needs `pkg-config` and ALSA development headers. The helper has no credentials or network transport. It captures and plays 24 kHz mono PCM, with echo processing and mute boundaries.

Release builds require all six OS and architecture binaries from the audio build workflow. Building locally produces only the current platform's helper.

Cross-platform support is experimental. Compilation and device-free checks do not establish real-device compatibility or acoustic quality. Please report issues with your OS, architecture, audio device and error message. Live audio and provider protocol compatibility still need validation.
