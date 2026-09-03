Use current machine identity before applying a host-specific value. Discover live device names and display modes instead of copying another host's config.

## Desktop sources

- `~/.config/hypr/`: Hyprland entry point and user overrides
- `~/.config/omarchy/shell.json`: complete Quickshell layout once present
- `~/.config/omarchy/extensions/`: menu and shell extensions
- `~/.config/omarchy/plugins/`: cloned and custom plugins
- `~/.config/omarchy/themes/` and `themed/`: theme sources and template overrides
- `~/.config/omarchy/hooks/`: user hooks
- `~/.config/uwsm/default`: GUI-session environment defaults, applied fully at next login
- `~/.config/mimeapps.list`: XDG file handlers

Determine whether a file is sourced, generated, copied, or linked before editing it.

`hyprctl` needs the running graphical session's environment. From SSH or a TTY, match the active Wayland session to the UWSM user-manager environment before importing `XDG_RUNTIME_DIR`, `WAYLAND_DISPLAY`, `DISPLAY`, and `HYPRLAND_INSTANCE_SIGNATURE`.

### Hyprland

Read `~/.config/hypr/hyprland.lua` first. It loads packaged defaults, user modules such as `monitors.lua`, `input.lua`, `bindings.lua`, `looknfeel.lua`, and `autostart.lua`, then packaged live toggles. Load order decides which value wins.

Treat unexpected Waybar, Walker, Mako, or Hyprland `.conf` files as inactive until the load path proves otherwise. Discover live identifiers with:

```bash
hyprctl monitors -j
hyprctl clients -j
hyprctl devices -j
```

Check the installed Hyprland version, local examples, and current documentation before introducing window rules.

### Quickshell

Quattro uses Quickshell for the bar, launcher, notifications, and shell plugins. `shell.json` is not deep-merged with packaged defaults.

Clone a built-in QML plugin with `omarchy plugin clone <id>`, then edit the user copy. Shell JSON, menu JSONC, and user plugins hot-reload. Use `omarchy-shell shell rescanPlugins` when discovery needs a nudge. Use `omarchy restart shell` only when hot reload fails or the change requires it. `omarchy refresh shell` resets config and is not a restart.

## Themes

Stock themes under `/usr/share/omarchy/themes/` are read-only. Put independent themes and stock-theme overlays under `~/.config/omarchy/themes/<slug>/`. An overlay may contain only the files it replaces. A complete theme normally contains `colors.toml`, `backgrounds/`, and `preview.png`.

Edit theme or template source, then reapply it. Never edit generated active-theme state. Templates support `{{ variable }}`, `{{ variable_strip }}`, and `{{ variable_rgb }}`.

Use current `omarchy theme ...` routes for selection and refresh. Boot unlock themes may contain `preview-unlock.png` and transparent `unlock.png`. Discover the current `omarchy plymouth ...` routes before changing Plymouth.

## Bindings and input

Quattro bindings live in `~/.config/hypr/bindings.lua`.

1. Inspect existing user and packaged bindings. Use `omarchy menu keybindings --print` when the installed route supports it.
2. Call `hl.unbind(...)` before replacing an inherited mapping.
3. Add the replacement with `o.bind(...)` and preserve its descriptive label.

Hyprland 0.55 and later dispatches use Lua expressions. Use forms such as:

```bash
hyprctl dispatch 'hl.dsp.layout("togglesplit")'
```

The old `hyprctl dispatch layoutmsg togglesplit` form fails on Quattro.

Input lives in `~/.config/hypr/input.lua`, autostart in `autostart.lua`, XCompose in `~/.XCompose`, and hooks under `~/.config/omarchy/hooks/`. Restart XCompose with `omarchy restart xcompose`.

Set Omarchy's launcher choices through the current `omarchy default ...` routes. Launcher choice is separate from shell environment and XDG MIME defaults. Change every relevant MIME type, not only `text/plain`. Terminal appearance may come from generated theme files, so edit the theme or template source.

## Automation

Night light scheduling is owned by `~/.config/hypr/hyprsunset.conf`, while activation is owned by the graphical-session `hyprsunset.service` or an explicit autostart entry. Inspect both the profiles and current service state. A schedule in the file is not live while the service is inactive. Apply a config change with `omarchy restart hyprsunset` only when night light is meant to run.

Quickshell's night-light control is a temporary temperature override. The next configured `hyprsunset` transition resumes the schedule when the service is active.

## Validation

After a binding or input change, reload Hyprland and inspect `hyprctl configerrors`. Confirm active values with the relevant `hyprctl getoption`, `hyprctl -j binds`, `hyprctl devices -j`, or menu output.

For GUI environment changes under `~/.config/uwsm/`, treat the next login as the full activation boundary. Never patch `/usr/share/omarchy`.
