# Omarchy Workstation Guide

Use this reference selectively. Local command metadata and installed source outrank examples here because Omarchy evolves quickly.

## Ownership and state

### Upstream-managed, inspect only

- `~/.local/share/omarchy/` — installed Omarchy source, commands, defaults, migrations, and stock themes.
- `~/.local/share/omarchy/bin/` — command implementations. Read these to verify side effects; do not patch them for workstation fixes.
- `~/.local/share/omarchy/config/` — default files copied into user config by refresh/reinstall workflows.
- `~/.local/share/omarchy/default/` — defaults sourced directly by user config and theme templates.
- `~/.local/share/omarchy/themes/` — stock theme sources.

The install root may differ. Resolve the actual `omarchy` executable and its scripts instead of assuming a path when the standard location is absent.

### User-owned, edit with context

- `~/.config/hypr/` — Hyprland entry point and user overrides.
- `~/.config/waybar/`, `walker/`, `mako/`, terminal directories — component config.
- `~/.config/omarchy/themes/` — installed or custom theme overlays.
- `~/.config/omarchy/themed/` — user template overrides when present.
- `~/.config/omarchy/hooks/` — user hooks.
- `~/.config/omarchy/current/` — generated active-theme state. Inspect it, but edit the theme source or template that generates it.
- `~/.local/state/omarchy/` — toggles and migration state. Treat it as live state, not cleanup debris.

Before editing, check whether a file is sourced, generated, copied, or linked. The path visible in an error or process may not be the durable source.

## Discover the current command surface

Prefer current routed commands:

```bash
omarchy commands --json
```

The inventory exposes routes, arguments, examples, hidden status, backing binaries, and sudo requirements. Filter it rather than pasting the full catalog into context:

```bash
omarchy commands --json | jq -r '.commands[] | select(.group == "restart") | [.route, .summary] | @tsv'
```

For exact behavior:

1. Find the matching entry and its `binary`.
2. Resolve that executable with `command -v`.
3. Read the script before any command whose replacement, removal, reset, upload, or system effects are unclear.

Use `omarchy <group> <command>` for execution. Hyphenated `omarchy-*` binaries are implementation details and may be renamed or regrouped.

## Understand operation scope

### Restart or reload

`omarchy restart ...` applies current config by reloading or restarting a component. It does not restore defaults. Use it routinely after a relevant edit when interruption is small and expected by the task.

Common discoverable routes include Hyprland, Waybar, Walker, Mako, terminals, PipeWire, Bluetooth, and Wi-Fi. Inspect current metadata rather than assuming every route exists.

### Refresh

`omarchy refresh ...` means replacement from Omarchy defaults, not a harmless reload.

- `omarchy refresh config <path>` copies one file from the installed default tree to `~/.config/`. Current implementations create a timestamped `.bak.<epoch>` when content changes.
- Component refresh commands may replace several files, create links or service overrides, and restart the component.
- `omarchy refresh hyprland` replaces multiple user Hyprland files.
- `omarchy refresh waybar` replaces config and style before restarting Waybar.
- `omarchy refresh walker` replaces Walker and Elephant config and may alter user service setup.

Before refresh, show which user files will be replaced and preserve existing customizations. Do not add another backup when the local implementation already creates an adequate one.

### Reinstall

Reinstall commands are broad recovery tools.

- Config reinstall can copy the full Omarchy config tree into `~/.config/` and replace shell or boot-related state.
- Package reinstall can reinstall the default package set.
- Full reinstall can combine package and config reset behavior.

Read the local script and obtain authorization for the exact scope. Do not use reinstall to fix one malformed component file.

### Update

`omarchy update` updates Omarchy and system packages. Current implementations may:

- create system snapshots when Snapper is available;
- update the Omarchy install tree;
- run migrations;
- update official and AUR packages;
- remove orphans;
- request service restarts or reboot;
- write `/tmp/omarchy-update.log`.

Run an update when requested, not as a generic attempt to fix unrelated config. On failure, keep the first error, inspect the log, run `omarchy update analyze logs` if available, and correct the specific blocker before retrying.

### Snapshots and system actions

Snapshot restore, channel/branch changes, hibernation, bootloader changes, security setup, package removal, logout, reboot, and shutdown are consequential. Confirm them unless the user explicitly requested that exact operation with clear scope.

## Hyprland configuration

Read `~/.config/hypr/hyprland.conf` first. A typical Omarchy setup sources:

1. upstream defaults from the Omarchy install;
2. generated theme files;
3. user files such as `monitors.conf`, `input.conf`, `bindings.conf`, `looknfeel.conf`, and `autostart.conf`;
4. `~/.config/hypr/conf.d/*.conf` for additional overrides;
5. live toggle files under `~/.local/state/omarchy/`.

The actual order controls which value wins. Add durable customization to the user layer after checking existing overrides; do not copy and edit the upstream source.

### Keybindings

- Inspect `bindings.conf`, `conf.d/`, and sourced defaults for collisions.
- Preserve descriptive `bindd` labels when the local convention uses them.
- Unbind an inherited key before replacing it when Hyprland would otherwise retain both actions.
- `omarchy menu keybindings` is an interactive viewer in current releases; inspect files directly for automation unless local metadata exposes a print mode.

### Window rules and displays

Hyprland rule syntax changes across versions. Check `hyprctl version`, existing local syntax, and current Hyprland documentation before introducing rules.

Discover live names and properties rather than guessing:

```bash
hyprctl monitors -j
hyprctl clients -j
hyprctl devices -j
```

After edits, reload through the current Omarchy restart route or `hyprctl reload`, then inspect `hyprctl configerrors` when supported.

## Desktop components

### Waybar

- Durable files are normally `~/.config/waybar/config.jsonc` and `style.css`.
- Theme CSS may be imported from generated Omarchy theme state; trace imports before editing.
- Restart Waybar after config or CSS changes. A refresh is only for restoring defaults.

### Walker and Elephant

- Walker config normally lives under `~/.config/walker/`; providers and menus may live under `~/.config/elephant/`.
- Restart through the current Omarchy route so associated user services are handled together.
- Refresh may replace configs and service overrides, so reserve it for reset/recovery.

### Mako and terminals

- Mako and supported terminals have scoped Omarchy restart routes that reload current config.
- Terminal and notification appearance may come from generated current-theme files. Change the source theme or user template rather than the generated copy.

### Visual validation

After a visual change, take a fresh screenshot when possible:

```bash
omarchy capture screenshot fullscreen save
```

Inspect the actual image for clipping, contrast, spacing, stale processes, and the affected state. A successful restart alone does not prove the visual result.

## Themes

Theme application commonly overlays a user theme from `~/.config/omarchy/themes/<name>/` onto a stock theme of the same name, generates component files, and atomically replaces `~/.config/omarchy/current/theme/`.

Therefore:

- do not make durable edits inside `current/theme/`;
- customize the user theme overlay or a user template;
- use `omarchy theme set <name>` to apply a theme;
- use `omarchy theme refresh` to regenerate the active theme after source/template changes;
- inspect third-party theme repositories before installation or update;
- expect theme application to restart several desktop components and run user theme hooks.

Use `omarchy theme current` and `omarchy theme list` when supported, but trust local command behavior if version commands fail outside the normal desktop environment.

## Audio, Bluetooth, Wi-Fi, and hardware

Use the Omarchy launch commands for interactive audio, Bluetooth, or Wi-Fi control when that matches the user's task. For diagnosis, inspect live state with the native tools available on the machine, such as `wpctl`, `bluetoothctl`, `rfkill`, `systemctl`, or Hyprland device output.

Use scoped restart commands only after evidence points to a stuck service or when applying known config. Restarting PipeWire, Bluetooth, or Wi-Fi interrupts active sessions; an explicit request to fix that subsystem normally authorizes the targeted restart, but unrelated disruption does not.

Never hardcode card indexes, sinks, Bluetooth addresses, network interfaces, monitor names, touchpad names, or GPU assumptions. Discover them each time.

## Packages and Arch safety

- Prefer Omarchy package helpers when available because they encode repository and AUR behavior.
- Inspect package presence before adding or removing when idempotence matters.
- Treat package removal and removal workflows as destructive; some remove application data, game libraries, configs, or caches.
- Avoid partial Arch upgrades. Do not run `pacman -Sy` by itself or combine stale package databases with selective upgrades.
- Do not switch Omarchy channel or git branch merely to obtain a newer package without discussing the support and update implications.

## Diagnostics and logs

Start narrow:

- current process and user-service status;
- component-specific `journalctl --user` output;
- system service status and current-boot journal when relevant;
- config parser or native status output;
- update log for update failures.

For broad context, current Omarchy versions expose:

```bash
omarchy debug --print --no-sudo
```

This can include hardware, journal, and package information. Inspect it locally and redact sensitive details before sharing. Running `omarchy debug` without `--print` may offer an upload action; never upload diagnostics without explicit user authorization.

## Small built-in workflows

Discover local syntax first, then prefer built-ins for tasks they own:

- reminders: `omarchy reminder`;
- screenshots and recordings: `omarchy capture ...`;
- themes and backgrounds: `omarchy theme ...`;
- default browser/editor/terminal: `omarchy default ...`;
- user hooks: `omarchy hook ...`;
- feature toggles: `omarchy toggle ...`.

Do not replace a working built-in workflow with a parallel custom script unless the user needs behavior the built-in cannot provide.

## Recovery order

Escalate only as far as evidence requires:

1. Correct the user-owned source and reload the component.
2. Restore a known-good user file or an Omarchy-created `.bak.<epoch>`.
3. Refresh one config file after reviewing the replacement diff.
4. Refresh one component after enumerating every affected file and service.
5. Reinstall configs or packages only for broad corruption and with explicit scope.
6. Restore a system snapshot only when the user accepts the rollback effects.

After recovery, reapply still-valid user customization deliberately rather than copying the entire broken state back over fresh defaults.
