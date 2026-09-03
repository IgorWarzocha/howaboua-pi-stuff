Use when an update appears to have reset keyboard layout, window style, autostart, dictation, or custom bindings.

1. Trace `~/.config/hypr/hyprland.lua` to confirm the active Lua files. Do not treat unexpected `.conf` files as active without evidence.
2. Find recent user backups:

```bash
find ~/.config/hypr -maxdepth 1 -type f -name '*.bak.*' -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort -r
```

3. Diff the relevant backup against current user config. Restore only the lost entries, not the whole file.
4. Check the affected sources:
   - `input.lua`: keyboard layout, variant, options, and device rules
   - `looknfeel.lua`: gaps, borders, rounding, layout, and animation overrides
   - `monitors.lua`: monitor mode, position, and scale
   - `autostart.lua`: user startup applications
   - `bindings.lua`: custom bindings and `hl.unbind(...)` calls
   - Any other module sourced by `hyprland.lua`: machine-specific rules and applications
5. Run `hyprctl reload` and `hyprctl configerrors`. Restart the shell only when its state also changed or hot reload failed.
6. Verify restored values from runtime evidence rather than an assumed default. Use focused `hyprctl getoption`, `hyprctl -j binds`, `hyprctl submap`, and menu queries.

Edit only user-owned files under `~/.config/`. Never restore over `/usr/share/omarchy/` or a compatibility link resolving there.
