---
name: omarchy-help
description: "Read before changing, diagnosing, maintaining, or recovering an Omarchy Quattro workstation."
last-changed: "2026-08-25"
---

1. Identify the requested outcome and affected layer. Inspect only the relevant config, process, device, service, or log.
2. Read the matching reference before acting:
   - Hyprland, Quickshell, themes, defaults, bindings, input, displays, or local automation: `references/personalization.md`
   - Update, refresh, reinstall, packages, snapshots, broad diagnostics, or staged recovery: `references/system-maintenance.md`
   - User config lost or reset after an update: `references/config-recovery.md`
   - Bluetooth adapter present but discovery broken: `references/bluetooth-fix.md`
   - Process crash, core dump, or Omarchy crash notification: `references/crash-diagnosis.md`
   - Freeze, heat, or stalled application: `references/runtime-triage.md`
   - Blank or locked physical display while connected remotely: `references/remote-unlock.md`
3. Resolve symlinks, generated files, and sourced config before editing. Treat `/usr/share/omarchy/` and a compatibility link resolving there as read-only. Put durable customization in user-owned config. Inspect generated active state under `~/.local/state/omarchy/current/` and other remembered state under `~/.local/state/omarchy/`, but do not mistake either for editable source.
4. Discover current device names, services, applications, routes, and command behavior from the machine. Use `omarchy commands --json` for the current route surface and prefer a routed `omarchy <group> <command>` when it owns the task. Read an implementation before running a command with unclear replacement, removal, reset, upload, or system effects.
5. Treat the graphical session as an environment boundary. Before using `hyprctl` from SSH or a TTY, identify the active Wayland session and import its current UWSM user-manager environment. A missing compositor socket from a remote shell does not prove Hyprland is down.
6. Choose the smallest durable action. Do not turn a focused change into a health audit, update, reset, or reinstall.
7. Routine user-config edits and scoped component reloads are part of the requested work. Confirm an unrequested config refresh, reinstall, package removal, snapshot restore, channel change, boot, security, or storage change, logout, reboot, or shutdown. Do not ask again when the user requested that exact action and its scope is clear.
8. Preserve unrelated config. Do not create backup clutter for small edits. Preserve rollback before broad replacement only when the command does not already do so.
9. Validate the affected component and runtime behavior:
   - Hyprland Lua: run `hyprctl reload` and `hyprctl configerrors`.
   - Shell JSON, menu JSONC, or user plugin: confirm `omarchy-shell shell ping`. Run `omarchy plugin validate <folder>` for a plugin package.
   - `hyprsunset.conf`: run `omarchy restart hyprsunset`.
   - Other components: use their native validation, then reload or restart only when needed.
10. For intermittent failures, inspect the relevant current process state and journal before changing more config.
11. Report the durable source changed, any reload or restart, and the observed result or exact blocker. Mention disruption, reboot requirements, generated backups, or manual follow-up only when applicable.

Do not capture the user's active desktop unless they requested the capture or approved the interruption. Prefer config, IPC, process, and runtime evidence.

Never upload diagnostics, logs, screenshots, recordings, or core dumps without explicit authorization.
