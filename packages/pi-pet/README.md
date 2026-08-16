# Pi Pet

Pi Pet gives a headless Pi session an animated companion you can see and talk to from any browser connected through SSH. One broker on the server fans state out to multiple displays; the bundled Pi extension drives Clawa from real lifecycle events and accepts prompts back into the active session.

![Clawa running in the Pi Pet browser display.](docs/pi-pet.png)

## What works

- Clawa's nine Codex-style activity animations and sixteen pointer-look directions.
- Automatic working, waiting, failure, and settled activity from Pi events, mapped onto each pet's actions.
- String-based `pet_show`, `pet_say`, and `pet_reload` tools with compact Pi rendering.
- Authenticated prompt submission from browser or native Clawa, with a bounded final reply bubble.
- Multiple simultaneous browser displays.
- Transparent, frameless, always-on-top Electron display, currently verified on Linux.
- Manifest-driven custom actions through `pet.pi.json`.
- Loopback by default, with explicit trusted-LAN mode for native clients.

## Server setup

From the monorepo root:

```bash
bun install --frozen-lockfile
bun --cwd=packages/pi-pet run build
packages/pi-pet/dist/pi-pet.mjs setup
packages/pi-pet/dist/pi-pet.mjs service install
```

The root `.pi/settings.json` loads Pi Pet only for Pi sessions started in this repository and stores those sessions under `.pi/sessions/`; trust the project when Pi asks. Run `/reload` after changing the local package. Check the service with:

```bash
packages/pi-pet/dist/pi-pet.mjs status
packages/pi-pet/dist/pi-pet.mjs display-url
```

`setup` creates two distinct 256-bit credentials in `~/.config/pi-pet/config.json` with mode `0600`. The service binds only to `127.0.0.1:43117` by default.

For development without a persistent service:

```bash
packages/pi-pet/dist/pi-pet.mjs serve
```

## Open it on desktop or laptop

On each display machine, keep an SSH tunnel open:

```bash
ssh -N -L 43117:127.0.0.1:43117 server
```

Then open the URL printed by `pi-pet display-url` in that machine's browser. The credential is in the URL fragment, so it is not sent in the HTTP request; the app removes it from the address bar and keeps it only for that browser tab.

Both browsers receive the same pet state. Closing a tunnel or browser does not affect Pi or the other display.

For a persistent client tunnel, install [`deploy/pi-pet-tunnel.service`](deploy/pi-pet-tunnel.service) as `~/.config/systemd/user/pi-pet-tunnel.service`, then run:

```bash
systemctl --user daemon-reload
systemctl --user enable --now pi-pet-tunnel.service
```

Remove it with `systemctl --user disable --now pi-pet-tunnel.service`, delete the unit, and run `systemctl --user daemon-reload`.

## Native desktop pet

The Electron shell loads the same broker-hosted renderer in a transparent window. It contains no agent runtime or duplicate pet protocol; a narrow sandboxed preload carries only validated cursor positions for focus-independent proximity watching.

For a direct trusted-LAN connection, explicitly enable LAN listening on the server and restart the broker:

```bash
packages/pi-pet/dist/pi-pet.mjs network lan
systemctl --user restart pi-pet.service
```

Build a current-platform bundle with `bun run desktop:package`, install its contents at `~/.local/share/pi-pet-desktop` on the display machine, and create `~/.config/pi-pet-desktop/config.json` with mode `0600`:

```json
{
  "schemaVersion": 1,
  "brokerUrl": "http://192.168.0.113:43117",
  "displayToken": "<display token>"
}
```

Run it with `runtime/electron app`. For login startup, install [`deploy/pi-pet-desktop.service`](deploy/pi-pet-desktop.service) as `~/.config/systemd/user/pi-pet-desktop.service`, then enable it:

```bash
systemctl --user daemon-reload
systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR HYPRLAND_INSTANCE_SIGNATURE
systemctl --user enable --now pi-pet-desktop.service
```

Move the cursor near Clawa to make her watch it without focusing the window. Click Clawa to open a compact prompt, press Enter to send, or Shift+Enter for a new line. Right-click for pet size, quiet mode,
15-minute/one-hour/until-tomorrow snooze, reload, or **Quit until next login**. Quiet mode leaves Clawa visible but
suppresses routine working motion; waiting, failure, one completion cycle, speech, and intentional actions remain visible. Clawa returns to her real idle after completion. Snooze hides
only that desktop display and wakes automatically. Neither option stops the server broker or Pi extension.

Return the broker to SSH-only display access with `pi-pet network loopback` and a service restart.

Hyprland compositors draw their own borders and may apply global window opacity. Source the bundled [`deploy/pi-pet-hyprland.conf`](deploy/pi-pet-hyprland.conf) from the user-owned Hyprland config to keep the pet borderless, pinned, and at the bottom-right edge.

Linux bundles use Chromium's unprivileged user-namespace sandbox and intentionally do not install a setuid helper. Confirm `kernel.unprivileged_userns_clone=1` on the display machine before launch.

## Use it from Pi

The extension normally updates the pet by itself. For intentional expression:

- `pet_show` accepts an action string documented by the active pet package.
- `pet_say` shows a short temporary bubble.
- `pet_reload` validates and hot-reloads edited pet data.

Replies to prompts sent through the pet are shown automatically after the turn settles; agents should not also call `pet_say` for those replies.

Status stays out of the model tool surface. Use `/pet-status` inside Pi or `pi-pet status` in a shell; both call the authenticated `GET /api/v1/status` broker endpoint. The full action catalog remains available to displays at `GET /api/v1/catalog`.

Load `hatch-pi-pet` to create or repair a complete character with deterministic atlas assembly and independent visual review. It can use any available image-generation capability or prepare an external/browser-assisted handoff for services such as ChatGPT, Gemini, or Grok Imagine. Use the smaller `pi-pet` skill for live control or adding one action. Clawa's source description is [`pets/clawa/PET.md`](pets/clawa/PET.md).

## Deliberate limits

- Only one live Pi session owns browser prompt routing. A second session fails explicitly instead of receiving prompts unpredictably.
- Direct LAN mode is plain HTTP for a trusted home network; it is not public-internet transport.
- Pet packages cannot contain code, HTML, remote URLs, or commands.

See [`docs/architecture.md`](docs/architecture.md), [`SECURITY.md`](SECURITY.md), and [`docs/research.md`](docs/research.md).
