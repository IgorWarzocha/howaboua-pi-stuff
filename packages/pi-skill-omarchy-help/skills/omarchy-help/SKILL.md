---
name: omarchy-help
description: "Maintains Arch Linux desktops configured with Omarchy. Use for user-level Hyprland, Waybar, Walker, Mako, terminals, themes, keybindings, displays, screenshots, updates, packages, Bluetooth, audio, reminders, or Omarchy troubleshooting. Not for developing or patching Omarchy itself."
---

# Omarchy Help

Maintain a live Omarchy workstation from the user and system administration layers. Complete the requested task directly; do not turn a focused config change or routine restart into a general health audit.

## Operating boundaries

- Treat `~/.local/share/omarchy/` as read-only reference and upstream-managed state. Official Omarchy update or reinstall commands may manage it; never patch it manually for workstation customization.
- Read existing user config before editing. Preserve local structure, includes, overrides, and unrelated changes.
- Discover device names, services, installed applications, theme names, and command availability from the machine. Do not assume them.
- Routine user-config edits and scoped component reloads are authorized when they are part of the requested fix or change.
- Confirm unrequested destructive or materially disruptive actions: config refresh/reset, reinstall, package removal, snapshot restore, channel or branch changes, boot/security/storage changes, logout, reboot, and shutdown. Do not ask again when the user explicitly requested that exact action and its scope is clear.
- Do not use system updates, broad resets, or reinstall commands as speculative troubleshooting.

## Reference

Read the relevant part of `references/workstation-guide.md` before changing Omarchy-managed config, themes, packages, updates, or recovery state. It documents ownership layers, current command discovery, component validation, and the difference between restart, refresh, reinstall, and update.

## Workflow

1. **Identify the requested outcome and current layer.**
   - For a precise task, inspect only the affected config, process, device, or status output.
   - Determine whether the durable source is user config, a custom theme/template, an Omarchy command, or system state.
   - Resolve symlinks and sourced config before editing generated or apparently duplicated files.

2. **Discover local behavior only as needed.**
   - Prefer the routed `omarchy <group> <command>` interface when it covers the task.
   - Use `omarchy commands --json` to discover current routes, arguments, examples, and sudo requirements instead of relying on a memorized command list.
   - When a command could overwrite files or has unclear side effects, inspect its resolved script in the installed Omarchy tree before running it.
   - Fall back to native Arch, Hyprland, systemd, PipeWire, Bluetooth, or application tooling when Omarchy has no suitable command.

3. **Choose the smallest durable action.**
   - Edit user-owned config for customization.
   - Use a restart or reload command to apply existing config; a restart is not a reset.
   - Use official theme, package, update, toggle, and setup commands when they own the workflow.
   - Use `refresh` only when replacing user config with current Omarchy defaults is the intended recovery action.
   - Use `reinstall` only for an explicitly requested broad repair or reset.

4. **Apply the change.**
   - Keep edits scoped and preserve comments and ordering where they carry meaning.
   - Do not create routine backup clutter for small edits. Preserve rollback before broad replacement when the command does not already do so.
   - Use an interactive terminal for commands that require sudo, menus, or confirmation.

5. **Validate the result, not the ritual.**
   - Run the component's native config/status check when one exists.
   - Reload or restart only the affected component unless the requested operation inherently spans the system.
   - For visual changes, inspect a fresh screenshot when the environment supports it.
   - For intermittent failures, inspect the relevant user/system journal and current process state before changing more config.

6. **Report the durable result.**
   - State what changed, which files or commands were involved, and whether a reload/restart occurred.
   - Mention remaining disruption, reboot requirements, backups created by Omarchy, or a manual follow-up only when applicable.

## Troubleshooting posture

- Start from the failing component, not a full-machine diagnostic dump.
- Use `omarchy debug --print --no-sudo` only when broad system context is useful. Inspect output locally; never upload or share logs without explicit authorization.
- For failed updates, preserve the original error and inspect `/tmp/omarchy-update.log` plus `omarchy update analyze logs` before retrying.
- If local command behavior differs from this skill, trust local command metadata and source, then avoid unsafe assumptions.

## Completion check

- The requested behavior works or the remaining blocker is identified with evidence.
- Durable edits live in user-owned sources rather than generated current-state files.
- No unrelated config, packages, services, or Omarchy upstream files changed.
- Any destructive recovery, external upload, or system-wide action was explicitly authorized.
