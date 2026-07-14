# @howaboua/pi-skill-omarchy-help

Maintains user-level Arch Linux desktops configured with Omarchy: Hyprland, Waybar, Walker, Mako, terminals, themes, keybindings, displays, screenshots, updates, packages, Bluetooth, and audio.

## Install

```bash
pi install npm:@howaboua/pi-skill-omarchy-help
```

Use it for workstation configuration and troubleshooting, not for developing or patching Omarchy itself. The skill treats `~/.local/share/omarchy/` as upstream-managed, read-only reference and prefers user-owned configuration or official Omarchy commands.

This machine-specific skill is intentionally excluded from `@howaboua/pi-skills` and `@howaboua/pi-stuff`.
