# Herdr Voice

Use your computer's microphone and speakers with Pi sessions on other machines, without opening a browser. A native Herdr panel controls a local Rust companion. Pi keeps the voice call, credentials and working context on its own machine.

Choose Grok or OpenAI, quickstart Pi in your home directory, or start voice in an existing Herdr pane. Switch audio devices and mute without changing Pi's working environment. The companion keeps running when the panel is hidden or reloaded.

OpenAI uses PCC's bundled GipPity voice or standalone GipPity, whichever is loaded in Pi. If both are loaded, it uses PCC. The panel shows which backend connected. A startup failure does not retry through the other extension.

## Requirements

- The new `herdr-app` and `herdr-core` installed locally.
- Pi with the selected voice extension and account access configured on each machine where Pi runs.
- Node.js on Pi's machine. The native companion itself does not require Node.js.
- A working microphone and speakers. Linux needs the ALSA runtime and a configured audio device. Allow microphone access when your OS asks.
- For remote machines, add them to Herdr first. Configure key-based SSH access and accept their host keys in your terminal before using SSH forwarding.

Voice control servers are unauthenticated and intended for trusted networks. Do not expose them to the internet. SSH forwarding protects traffic between machines, but does not change the server's existing network binding. Restrict access with your firewall when needed.

## Build and start

From this directory, with Rust, Node.js and the platform's native TLS development libraries installed:

```sh
node build.mjs
```

The result is `dist/herdr-voice-<platform>-<architecture>/`. Keep its `herdr-voice` and `grok-audio` executables together. Add the whole directory to your `PATH`, then run:

```sh
herdr-voice install-mod
herdr-voice serve
```

`install-mod` installs the panel as `voice` in your Herdr app home. It respects `HERDR_APP_HOME`, or accepts `--herdr-home PATH` for a separate installation. It also installs the local panel's private authorisation token. Do not share `mods/voice/companion.json`.

The companion stays in the foreground and opens no microphone until you connect. Keep it running in a local terminal, or run it under your own process supervisor. Closing it disconnects local audio. Opening or closing the Herdr panel does not stop it.

Open `voice` from Herdr's command palette to choose a provider and audio devices. Choices persist across panel copies and app restarts.

For compact controls beside your terminals, add this block to a personal Herdr layout. Clone a shipped layout before changing its structure.

```json
{ "id": "voice", "type": "block", "size": { "px": 44 }, "content": { "mod": "voice", "props": { "compact": true } } }
```

The lightning icon quickstarts Pi and voice on the focused pane's machine. Pi starts in that user's home directory. The plug icon connects voice to the focused Pi pane. Both start directly with your saved choices. Settings can override the machine or Pi pane. The gear opens settings, not another launch screen. Hover an icon for its action or current error.

While connected, the microphone icon mutes or unmutes and the disconnect icon ends the selected host call and releases local audio. The panel waits for the intended Pi session to confirm its voice server before connecting your microphone.

Quickstart installs the bundled Pi bridge in that machine's auto-discovered Pi extensions directory. It does not install a voice backend, change account access or submit a model prompt when the backend is missing. A failed connection leaves the new Pi terminal available to inspect.

## Use an existing pane

Copy the bundled `pi-bridge.ts` into Pi's auto-discovered extensions directory as `herdr-voice-bridge.ts`, then run `/reload` in the intended Pi session. Use the same filename as Quickstart, not a second registered copy. From the native bundle directory:

```sh
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir/extensions"
cp pi-bridge.ts "$agent_dir/extensions/herdr-voice-bridge.ts"
```

Focus that Pi pane and click the plug icon. Requests use the bridge's session-addressed mailbox, not simulated keystrokes, so an existing draft is not overwritten. Pi must have the bridge and chosen voice extension loaded. Already-running Pi sessions need one `/reload` after installing the bridge.

For remote Pi, the optional **SSH host** is the host alias from your local SSH configuration. Forwarding connects to the voice listener's loopback address on that host. It must be the same machine as the selected Pi session. Without forwarding, the returned server URL must be reachable on your trusted network.

## Manual connections

The panel's manual connection controls can attach to a voice server you have already started with `/grok server ensure`, `/codex voice server ensure` for PCC, or `/gippity server ensure`. Select Grok or OpenAI to match the server, then enter its HTTPS URL. For a self-signed server, select a local copy of its PEM certificate. Certificate verification remains enabled. Manual connections use your selected protocol and cannot identify which OpenAI extension owns the server.

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

**Disconnect** immediately releases this computer's audio and waits for the selected host call to stop. If the host cannot confirm Stop, the companion reports the failure and leaves local audio closed. Older host extensions need an update to confirm completion. Stop the call from Pi if confirmation fails. Tasks already submitted to Pi cannot be retracted. Network loss, closing the companion and replacement by another device release only local audio and leave the host-owned call available for reconnection.

The companion also provides `status`, `devices`, `mute true`, `mute false` and `disconnect` commands. Device discovery does not start a call.

## Recovery

- If the panel cannot reach the companion, start `herdr-voice serve` on the computer with the microphone.
- If authorisation fails, run `herdr-voice install-mod` again with the same Herdr app home.
- If a pane has no bridge, install `pi-bridge.ts` there and run `/reload`, or use Quickstart.
- If startup times out, inspect the Pi pane before retrying. Its server may still be starting.
- If SSH fails, check the alias, host key and key-based login in your terminal. The companion does not answer password prompts.
- If a connection fails, check its certificate, server address and selected audio devices, then reconnect. It never disables TLS verification or switches providers automatically.
