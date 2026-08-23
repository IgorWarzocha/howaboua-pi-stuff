Inspect local command metadata and implementation before any replacement, removal, reset, upload, or broad system action.

## Packaged state

Inspect the installed Omarchy tree, commonly `/usr/share/omarchy/` or a compatibility link from `~/.local/share/omarchy/`. Never patch it for workstation customization. Resolve the actual `omarchy` executable and install root when the standard path is absent.

## Classify the action

- **Restart or reload** applies current config. Use it after a relevant edit when interruption is expected and narrow.
- **Refresh** replaces user config from packaged defaults. Inspect affected files first and preserve customizations. Do not add a second backup when the command creates an adequate backup.
- **Reinstall** is broad recovery. Read the implementation and confirm the exact config, package, or full-system scope. Never use it for one malformed file.
- **Update** may change Omarchy and system packages, run migrations, remove orphans, create snapshots, and require service restarts or reboot. Run it when requested, not as speculative troubleshooting. On failure, preserve the first error, inspect the update log, then use an available Omarchy diagnostic route.
- **Snapshot restore, channel changes, bootloader changes, security setup, package removal, logout, reboot, and shutdown** require clear requested scope.

## Packages and recovery

Prefer Omarchy package helpers when they own the workflow. Inspect package presence when idempotence matters. Package removal may also remove user data, libraries, config, or caches.

Avoid partial Arch upgrades. Never run `pacman -Sy` alone or use stale package databases for selective upgrades.

Start with the affected process, user or system service, current-boot journal, and native config validation. Use broad diagnostics only when narrow evidence is insufficient. Inspect output locally and redact sensitive details before any authorized sharing.

Escalate only as far as evidence requires:

1. Correct the user-owned source and reload the component.
2. Restore a known-good user file or an Omarchy-created backup.
3. Refresh one config file after reviewing the replacement diff.
4. Refresh one component after enumerating affected files and services.
5. Reinstall config or packages for broad corruption with explicit scope.
6. Restore a snapshot only after the user accepts the rollback effects.

Reapply valid customization deliberately. Do not copy the entire broken state over fresh defaults.
