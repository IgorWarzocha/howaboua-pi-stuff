# Herdr Voice

Use your computer's microphone and speakers with Pi sessions on other machines, without opening a browser. A native Herdr panel controls a local Rust companion. Pi keeps the voice call, credentials and working context on its own machine.

Choose Grok or GipPity, quickstart Pi in your home directory, or start voice in an existing Herdr pane. Switch audio devices and mute without changing Pi's working environment. The companion keeps running when the panel is hidden or reloaded.

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

Open `voice` from Herdr's command palette. Choose a provider and a machine, then **Quickstart**. Pi starts in that user's home directory. The panel waits for the intended Pi session to confirm its voice server before connecting your microphone.

Quickstart installs the bundled Pi bridge in that machine's auto-discovered Pi extensions directory. It does not install a voice backend, change account access or submit a model prompt when the backend is missing. A failed connection leaves the new Pi terminal available to inspect.

## Use an existing pane

Install the bundled `pi-bridge.ts` as a Pi extension on that machine, then run `/reload` in the intended Pi session. For example, from the native bundle directory:

```sh
pi install ./pi-bridge.ts
```

Choose that pane in the voice panel and start the selected backend. Requests use the bridge's session-addressed mailbox, not simulated keystrokes, so an existing draft is not overwritten. Pi must have the chosen voice extension loaded.

For remote Pi, the optional **SSH host** is the host alias from your local SSH configuration. Forwarding connects to the voice listener's loopback address on that host. It must be the same machine as the selected Pi session. Without forwarding, the returned server URL must be reachable on your trusted network.

## Manual connections

The panel's manual connection controls can attach to a voice server you have already started with `/grok server ensure` or `/gippity server ensure`. Enter its HTTPS URL. For a self-signed server, select a local copy of its PEM certificate. Certificate verification remains enabled.

Quickstart and pane-based connections obtain the server certificate through Herdr Core's authenticated machine connection. You do not need to export it manually.

**Disconnect** releases this computer's audio. It leaves the host-owned voice call available for another device. End the call from Pi when you want to stop it entirely. A second device can replace the current audio connection.

The companion also provides `status`, `devices`, `mute true`, `mute false` and `disconnect` commands. Device discovery does not start a call.

## Recovery

- If the panel cannot reach the companion, start `herdr-voice serve` on the computer with the microphone.
- If authorisation fails, run `herdr-voice install-mod` again with the same Herdr app home.
- If a pane has no bridge, install `pi-bridge.ts` there and run `/reload`, or use Quickstart.
- If startup times out, inspect the Pi pane before retrying. Its server may still be starting.
- If SSH fails, check the alias, host key and key-based login in your terminal. The companion does not answer password prompts.
- If a connection fails, check its certificate, server address and selected audio devices, then reconnect. It never disables TLS verification or switches providers automatically.
