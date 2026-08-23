Determine whether a file is sourced, generated, copied, or linked before editing it. Discover live device names and display modes instead of copying another machine's config.

## User-owned sources

Common customization roots include:

- `~/.config/hypr/` for Hyprland entrypoints and overrides
- `~/.config/omarchy/` for themes, templates, hooks, shell settings, extensions, and plugins
- component-specific config such as Waybar, launcher, notification, terminal, and MIME settings

The active file may differ by Omarchy version. Resolve imports and generated state before deciding where a durable change belongs.

## Compositor and shell

Read the active compositor entrypoint before editing bindings, input, monitor, appearance, or autostart configuration. Some Omarchy versions use Lua user modules while others use sourced configuration files. Load order decides which value wins.

Discover live identifiers before adding display, input, or window rules:

```bash
hyprctl monitors -j
hyprctl clients -j
hyprctl devices -j
```

Check the installed compositor version, local examples, and current documentation before introducing new rule syntax.

For a user shell, bar, launcher, notification system, or plugin, use the installed Omarchy route for reload or validation when available. Treat refresh as a reset, not a restart.

## Themes

Keep stock themes in the installed Omarchy tree read-only. Put independent themes and stock-theme overlays in the user theme directory. Edit theme or template source, then reapply it. Never edit generated active-theme state.

Discover current `omarchy theme` and boot-theme routes before changing theme selection or display assets.

## Bindings and input

Inspect existing user and packaged bindings before adding a replacement. Remove or unbind an inherited mapping when the compositor would otherwise retain both actions. Preserve descriptive labels where the local configuration uses them.

Discover the current binding, input, autostart, compose, and hook files from the active configuration rather than assuming a filename or keyboard layout.

## Validation

After a binding, input, display, or appearance change, reload the affected component and inspect its native config errors. Confirm active values with the component's status or IPC interface.
