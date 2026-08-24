# @howaboua/pi-skill-omarchy-help

Maintains user-owned configuration and diagnoses failures on Arch Linux workstations configured with Omarchy.

## Install

```bash
pi install npm:@howaboua/pi-skill-omarchy-help
```

Use it for workstation configuration and troubleshooting, not for developing or patching Omarchy itself. The skill treats the installed Omarchy tree as upstream-managed, read-only reference and prefers user-owned configuration or official Omarchy commands.

This Omarchy-specific skill is intentionally excluded from `@howaboua/pi-skills` and `@howaboua/pi-stuff`.
