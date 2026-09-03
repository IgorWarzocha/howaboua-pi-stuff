Inspect local command metadata and implementation before any replacement, removal, reset, upload, or broad system action.

## Packaged state

Inspect `/usr/share/omarchy/`, including `bin/`, `config/`, `default/`, and `themes/`. Never patch it for workstation customization. `~/.local/share/omarchy` may link there. Resolve the link first.

Quattro may ship generic agent skills under `/usr/share/omarchy/default/agents/skills/`. Treat them as read-only upstream reference. Do not edit packaged skills or assume their presence makes them active in the current agent harness.

Resolve the actual `omarchy` executable and install root if the standard path is absent.

## Classify the action

- **Restart or reload** applies current config. Use it after a relevant edit when interruption is expected and narrow.
- **Refresh** replaces user config from packaged defaults. Inspect affected files first and preserve customizations. Do not add a second backup when the command creates an adequate `.bak.<epoch>`.
- **Reinstall** is broad recovery. Read the implementation and confirm the exact config, package, or full-system scope. Never use it for one malformed file.
- **Update** may change Omarchy and system packages, run migrations, remove orphans, create snapshots, and require service restarts or reboot. Run it when requested, not as speculative troubleshooting. On failure, preserve the first error, inspect `/tmp/omarchy-update.log`, then use `omarchy update analyze logs` when available.
- **Snapshot restore, channel changes, hibernation, bootloader changes, security setup, package removal, logout, reboot, and shutdown** require clear requested scope.

## Packages

Prefer Omarchy package helpers when they own the workflow. Inspect package presence when idempotence matters. Package removal may also remove user data, libraries, config, or caches.

Avoid partial Arch upgrades. Never run `pacman -Sy` alone or use stale package databases for selective upgrades.

## Diagnose and recover

Start with the affected process, user or system service, current-boot journal, and native config validation. Use `omarchy debug --print --no-sudo` only when broad context is useful. Inspect output locally and redact sensitive details before any authorized sharing. Do not use an upload flow by default.

Escalate only as far as evidence requires:

1. Correct the user-owned source and reload the component.
2. Restore a known-good user file or an Omarchy-created backup.
3. Refresh one config file after reviewing the replacement diff.
4. Refresh one component after enumerating affected files and services.
5. Reinstall config or packages for broad corruption with explicit scope.
6. Restore a snapshot only after the user accepts the rollback effects.

Reapply valid customization deliberately. Do not copy the entire broken state over fresh defaults.
