---
name: pi-pet-operations
description: "Pi Pet runtime operations and trusted-LAN desktop deployment. Use for start, stop, restart, status, Electron packaging, laptop/desktop install or update, Hyprland verification, screenshots, or remote pet troubleshooting. Not pet action or artwork authoring."
compatibility: "Pi Pet repository on server; systemd user services and Hyprland clients on Igor's Linux laptop/desktop."
---

# Pi Pet Operations

Run from the server repository root.

## Fast paths

```bash
# Required before any desktop/laptop launch or install
bun run ai:check:strict

# Broker
systemctl --user restart pi-pet.service
curl -fsS http://127.0.0.1:43117/health

# Existing native client
ssh laptop  'systemctl --user start|stop|restart|status pi-pet-desktop.service'
ssh desktop 'systemctl --user start|stop|restart|status pi-pet-desktop.service'

# Current-platform distributable
bun run desktop:package
# release/pi-pet-desktop-linux-x64/{app,runtime}
```

Use one real verb in place of `start|stop|restart|status`; do not paste the pipe form literally.

## Install or update a client

1. Verify the target hostname. Desktop SSH wakes the machine when necessary.
2. Package only after the strict gate passes.
3. Transfer `release/pi-pet-desktop-linux-x64/{app,runtime}` to `~/.local/share/pi-pet-desktop/` through a staging directory.
4. Write mode-`0600` `~/.config/pi-pet-desktop/config.json` with server URL `http://192.168.0.113:43117` and the server config's display token. Never print the token.
5. Install `deploy/pi-pet-desktop.service` and `deploy/pi-pet-hyprland.conf`; source the latter once from `~/.config/hypr/hyprland.conf`.
6. `systemctl --user daemon-reload`, import the graphical environment, reload Hyprland, then enable/start the service.

Laptop bulk transfer may use `ssh laptop`. The desktop wake proxy fails on large streams; after `ssh desktop hostname` returns `desktop`, use:

```bash
ssh -o ProxyCommand=none -i ~/.ssh/server igorw@192.168.0.228
scp -o ProxyCommand=none -i ~/.ssh/server ... igorw@192.168.0.228:...
```

## Verify

- Service is `enabled` and `active`; broker `/health` works from the target.
- `hyprctl configerrors` is empty.
- Client title is `Clawa · Pi Pet`, matches its selected size, and is floating and pinned.
- Capture with `grim`; verify transparent corners reveal the actual underlying window.
- Stop once and confirm it completes promptly. The installed unit must report `KillMode=mixed` and `TimeoutStopUSec=5s`.
- The native prompt provenance must match the hostname (`laptop` or `desktop`).

## Recovery

- Desktop bulk SSH raises `BlockingIOError`: use the verified raw-IP command above; do not change the wake proxy.
- Transparency briefly reveals wallpaper: capture again before changing rules; only investigate if reproducible.
- Blank transparent pet on Linux: confirm the packaged source still disables GPU compositing; inspect the user journal.
- Cursor watching fails on Hyprland: confirm the service manager has `XDG_RUNTIME_DIR` and `HYPRLAND_INSTANCE_SIGNATURE`, then verify `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket.sock`; do not rely on Electron global cursor coordinates under Wayland.
- Never expose the broker beyond the trusted LAN or widen its firewall rule as a deployment shortcut.
