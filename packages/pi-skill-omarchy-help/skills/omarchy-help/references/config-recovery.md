Use when an update appears to have reset user configuration.

1. Trace the active Omarchy and compositor configuration before treating an unexpected file as authoritative.
2. Find recent user backups created by Omarchy or the affected component.
3. Diff the relevant backup against current user config. Restore only the lost entries, not the whole file.
4. Check the affected user-owned source for the lost setting, binding, display rule, input rule, theme override, or autostart entry.
5. Run the component's reload and native error check.
6. Verify the restored runtime value or behavior through the component's status or IPC interface.

Edit only user-owned configuration. Never restore over the installed Omarchy tree or a compatibility link resolving there.
