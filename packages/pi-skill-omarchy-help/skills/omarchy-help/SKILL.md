---
name: omarchy-help
description: "Read before changing, diagnosing, maintaining, or recovering an Omarchy workstation."
---

1. Identify the requested outcome and affected layer. Inspect only the relevant config, process, device, service, or log.
2. Resolve symlinks, generated files, and sourced config before editing. Treat the installed Omarchy tree, commonly `/usr/share/omarchy/` or a compatibility link from `~/.local/share/omarchy/`, as read-only. Put durable customization in user-owned config.
3. Discover current device names, services, applications, routes, and command behavior from the machine. Use `omarchy commands --json` when available and prefer a routed `omarchy <group> <command>` when it owns the task. Read an implementation before running a command with unclear replacement, removal, reset, upload, or system effects.
4. Restart or reload applies current configuration. Refresh replaces user config from packaged defaults. Reinstall is broad recovery. Update may change Omarchy, system packages, migrations, snapshots, and services. Treat refresh, reinstall, update, package removal, snapshot restore, channel change, boot, security, storage, logout, reboot, and shutdown as consequential unless the user requested the exact scope.
5. Choose the smallest durable action. Do not turn a focused change into a health audit, update, reset, or reinstall. Preserve unrelated config and do not create backup clutter for small edits.
6. Validate the affected component with its native config or status check, then reload or restart only when needed. For intermittent failures, inspect relevant current process state and journals before changing more config.
7. Report the durable source changed, any reload or restart, and the observed result or exact blocker. Mention disruption, reboot requirements, generated backups, or manual follow-up only when applicable.

Do not capture the active desktop without explicit approval. Never upload diagnostics, logs, screenshots, recordings, or core dumps without explicit authorization.
