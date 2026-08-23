---
name: omarchy-help
description: "Read before changing, diagnosing, maintaining, or recovering an Omarchy workstation."
---

1. Identify the requested outcome and affected layer. Inspect only the relevant config, process, device, service, or log.
2. Read the matching reference before acting:
   - Hyprland, shell, themes, bindings, input, displays, or automation: `references/personalization.md`
   - Update, refresh, reinstall, packages, snapshots, broad diagnostics, or staged recovery: `references/system-maintenance.md`
   - User config lost or reset after an update: `references/config-recovery.md`
   - Bluetooth adapter present but discovery broken: `references/bluetooth-fix.md`
   - Process crash or core dump: `references/crash-diagnosis.md`
   - Freeze or stalled application: `references/runtime-triage.md`
   - Blank or locked physical display while connected remotely: `references/remote-unlock.md`
3. Resolve symlinks, generated files, and sourced config before editing. Treat the installed Omarchy tree, commonly `/usr/share/omarchy/` or a compatibility link from `~/.local/share/omarchy/`, as read-only. Put durable customization in user-owned config. Inspect active generated state and live state, but do not mistake either for editable source.
4. Discover current device names, services, applications, routes, and command behavior from the machine. Use `omarchy commands --json` when available and prefer a routed `omarchy <group> <command>` when it owns the task. Read an implementation before running a command with unclear replacement, removal, reset, upload, or system effects.
5. Choose the smallest durable action. Do not turn a focused change into a health audit, update, reset, or reinstall.
6. Routine user-config edits and scoped component reloads are part of the requested work. Confirm an unrequested config refresh, reinstall, package removal, snapshot restore, channel change, boot, security, or storage change, logout, reboot, or shutdown. Do not ask again when the user requested that exact action and its scope is clear.
7. Preserve unrelated config. Do not create backup clutter for small edits. Preserve rollback before broad replacement only when the command does not already do so.
8. Validate the affected component with its native config or status check, then reload or restart only when needed.
9. For intermittent failures, inspect relevant current process state and journals before changing more config.
10. Report the durable source changed, any reload or restart, and the observed result or exact blocker. Mention disruption, reboot requirements, generated backups, or manual follow-up only when applicable.

Do not capture the active desktop without explicit approval. Prefer config, IPC, process, and runtime evidence.

Never upload diagnostics, logs, screenshots, recordings, or core dumps without explicit authorization.
