# Herdr Voice

Use your computer's microphone and speakers with Pi sessions on other machines, without opening a browser. A native Herdr panel controls a local Rust companion. Pi keeps the voice call, credentials and working context on its own machine.

Choose Grok or OpenAI, quickstart Pi in your home directory, or start voice in an existing Herdr pane. Switch audio devices and mute without changing Pi's working environment. The companion keeps running when the panel is hidden or reloaded.

OpenAI uses PCC's bundled GipPity voice or standalone GipPity, whichever is loaded in Pi. If both are loaded, it uses PCC. The panel shows which backend connected. A startup failure does not retry through the other extension.

## Requirements

- Herdr with `herdr-app` and `herdr-core` installed locally.
- Pi with the selected voice extension and account access configured on each machine where Pi runs. Install `@howaboua/pi-codex-conversion`, `@howaboua/pi-gippity-control` or `@howaboua/pi-grok-realtime` from the same coordinated release or source revision as this app. An older install may lack host settings or confirmed call shutdown. After updating an extension, run `/reload` in each Pi session you intend to connect.
- Node.js on Pi's machine. The native companion itself does not require Node.js.
- A working microphone and speakers. Allow microphone access when your OS asks. Linux needs the ALSA runtime and its configuration files. The bundled Linux x64 `grok-audio` helper requires glibc 2.34 or newer.
- On Linux with PipeWire, a running local PipeWire session, `pw-dump` on the companion's `PATH` and the ALSA PipeWire PCM plugin are required for named device selection. Distribution package names vary. Without a local PipeWire session, the companion uses the audio helper's native device list.
- For remote machines, add them to Herdr first. Configure key-based SSH access and accept their host keys in your terminal before using SSH forwarding.

Voice control servers are unauthenticated and intended for trusted networks. Do not expose them to the internet. SSH forwarding protects traffic between machines, but does not change the server's existing network binding. Restrict access with your firewall when needed.

## Install and start a native bundle

The source build below produces a native bundle directory. If someone has supplied you with that directory, use the bundle for your computer's operating system and architecture. You do not need Rust or the source checkout to run it. The bundle does not contain `build.mjs`.

Keep the whole directory, including `herdr-voice`, `grok-audio`, `pi-bridge.ts` and the licence files. On Linux or macOS, open a terminal in that bundle directory and run:

```sh
export PATH="$PWD:$PATH"
herdr-voice install-mod
herdr-voice serve
```

This adds the bundle to `PATH` for the current terminal only. Add its absolute directory to your shell's `PATH` configuration if you want to run the companion from other terminals. On Windows, the executables have an `.exe` suffix. From PowerShell in the bundle directory, run `./herdr-voice.exe install-mod`, then `./herdr-voice.exe serve`.

`install-mod` installs the panel as `voice` in your Herdr app home. It respects `HERDR_APP_HOME`, or accepts `--herdr-home PATH` for a separate installation. It also installs the local panel's private authorisation token. Do not share `mods/voice/companion.json`.

The companion stays in the foreground and opens no microphone until you connect. Keep it running in a local terminal, or run it under your own process supervisor. Closing it disconnects local audio. Opening or closing the Herdr panel does not stop it.

Open `voice` from Herdr's command palette to choose a provider and audio devices. Choices persist across panel copies and app restarts.

For compact controls beside your terminals, add this block to a personal Herdr layout. Clone a shipped layout before changing its structure.

```json
{ "id": "voice", "type": "block", "size": { "px": 44 }, "content": { "mod": "voice", "props": { "compact": true } } }
```

The lightning icon quickstarts Pi and voice on the focused pane's machine. Pi starts in that user's home directory. The plug icon connects voice to the focused Pi pane. Both use your saved call provider and audio choices. The gear opens settings. Hover an icon for its action or current error.

Microphone and speaker choices always belong to the computer running the companion, even when Pi runs remotely. On Linux with PipeWire, the picker shows named local audio devices rather than ALSA plugin endpoints. System default follows this computer's audio configuration. A missing selected device fails instead of switching to another device.

Settings lets you choose a host and its PCC Voice, Gippity Voice or Grok extension independently of the focused pane. Its global settings load automatically, without starting Pi, a voice listener or a call. The extension must be installed and configured globally on that host. **Reload** fetches external changes without background settings polling. **Save host settings** writes there. Project overrides remain unchanged and take precedence. Changes apply to new calls, not the active call. **Connect to focused pane** connects voice to the focused Pi pane, just like the toolbar. The host selection only controls the settings editor, not where voice connects.

While connected, the microphone icon mutes or unmutes and the disconnect icon ends the selected host call and releases local audio. The panel waits for the intended Pi session to confirm its voice server before connecting your microphone.

Quickstart installs the bundled Pi bridge in that machine's auto-discovered Pi extensions directory. It does not install a voice backend, change account access or submit a model prompt when the backend is missing. A failed connection leaves the new Pi terminal available to inspect.

## Build from source

Use a checkout of this repository, not a native bundle. You need Rust 1.89 or newer for the locked dependencies, Cargo, Node.js and the platform's native linker and TLS development libraries. On Linux, this includes OpenSSL development files and `pkg-config`.

From the repository root:

```sh
cd apps/herdr-voice
node build.mjs
```

The script builds for your machine and copies the repository's matching audio helper unchanged. It produces `dist/herdr-voice-<platform>-<architecture>/`, such as `dist/herdr-voice-linux-x64/`. It supports Linux, macOS and Windows on x64 and arm64. Keep the generated directory intact and follow the native bundle instructions above from inside it. No separate download is needed for a source build.

## Use an existing pane

Install the bundled `pi-bridge.ts` on the machine **running Pi**, not merely on the computer displaying Herdr. Use Pi's auto-discovered extensions directory and the filename `herdr-voice-bridge.ts`, the same managed path as Quickstart. Do not register a second copy. The commands below refuse to overwrite an unrelated extension at that path.

If Pi runs on this computer, run this from the native bundle directory in a POSIX shell:

```sh
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir/extensions"
bridge="$agent_dir/extensions/herdr-voice-bridge.ts"
if [ ! -e "$bridge" ] || [ "$(head -n 1 "$bridge")" = '// herdr-voice-managed-bridge v1' ]; then
  cp pi-bridge.ts "$bridge"
else
  printf '%s\n' "Unrelated extension at $bridge. Move it before retrying." >&2
fi
```

If Pi runs remotely, replace `your-ssh-alias` with its configured SSH alias. From the native bundle directory on this computer, run:

```sh
pi_host='your-ssh-alias'
ssh "$pi_host" '
  set -eu
  agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  mkdir -p "$agent_dir/extensions"
  bridge="$agent_dir/extensions/herdr-voice-bridge.ts"
  if [ -e "$bridge" ] && [ "$(head -n 1 "$bridge")" != "// herdr-voice-managed-bridge v1" ]; then
    printf "%s\n" "Unrelated extension at $bridge. Move it before retrying." >&2
    exit 1
  fi
  umask 077
  cat > "$bridge"
' < pi-bridge.ts
```

The file travels over SSH and is written only on Pi's host. If that Pi session uses a custom `PI_CODING_AGENT_DIR`, set `agent_dir` to that same directory in the remote script. The SSH environment may differ from the Pi pane's environment. These manual shell examples require a POSIX shell on Pi's host. For a Windows host without one, use Quickstart to provision the bridge instead.

After a successful install, run `/reload` in the intended Pi session on that host. Focus that Pi pane and click the plug icon. Requests use the bridge's session-addressed mailbox, not simulated keystrokes, so an existing draft is not overwritten. Pi must have both the bridge and chosen voice extension loaded.

Quickstart and pane-based connections obtain the server certificate through Herdr Core's authenticated machine connection. You do not need to export it manually.

## Agent and pane indicators

Personal agent-list and pane-header mods can show which Pi has this computer's active voice connection, including mute state. This is separate from Pi's working indicator. Manual URL connections cannot identify a Pi pane and do not mark one.

Clone the shipped mods before customising them, then install the indicator helper into those personal copies:

```sh
herdr-app do mod.clone --name agents --as voice-agents
herdr-app do mod.clone --name pane --as voice-pane
herdr-voice install-mod --indicator-mod voice-agents --indicator-mod voice-pane
```

Each copy can import `voiceActive` and `voiceIndicator` from `./voice-indicator.js`. Render the indicator beside its existing status when `voiceActive(terminal)` is true. Pass the agent's full address or the pane header's terminal address. Point your personal layout at those customised mods. Herdr isolates each mod's JavaScript, so importing the helper directly from another mod is not supported.

**Disconnect** immediately releases this computer's audio, waits for the selected host call to stop and requests shutdown of its LAN listener. If the host cannot confirm Stop or accept the shutdown request, the companion reports the failure and leaves local audio closed. Update older host extensions and run `/reload` in Pi before reconnecting. Stop the call from Pi if confirmation fails. Tasks already submitted to Pi cannot be retracted. Browser Stop keeps the listener available. Network loss, closing the companion and replacement by another device release only local audio and leave the host-owned call available for reconnection.

The companion also provides `status`, `devices`, `mute true`, `mute false` and `disconnect` commands. Device discovery does not start a call.

## Recovery

- If the panel cannot reach the companion, start `herdr-voice serve` on the computer with the microphone.
- If authorisation fails, run `herdr-voice install-mod` again with the same Herdr app home.
- If a pane has no bridge, install `pi-bridge.ts` there and run `/reload`, or use Quickstart.
- If startup times out, inspect the Pi pane before retrying. Its server may still be starting.
- If SSH fails, check the alias, host key and key-based login in your terminal. The companion does not answer password prompts.
- If a connection fails, check its certificate, server address and selected audio devices, then reconnect. It never disables TLS verification or switches providers automatically.
- If a selected microphone or speaker disappears, reconnect the device or choose an available local device in settings, then connect again. Choose **System default** if you want to follow the computer's default device. A saved missing device is never silently replaced.
- If Linux device discovery fails while PipeWire is running, check that `pw-dump` is available to the companion and the local PipeWire session is healthy. If named devices appear but cannot open, check the ALSA PipeWire PCM plugin and ALSA configuration files. Restart the companion after correcting its environment, then select the devices again.
