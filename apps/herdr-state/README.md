# Herdr State

Save the coding-agent conversations open in Herdr, then restore them after a reboot. The sidebar has two buttons: **Save** and **Restore**. Nothing watches for shutdowns or polls for changes.

Save records spaces, tabs, splits, folders and exact native session references. Each machine stores its own snapshot in its Core state, so closing the viewing desktop does not lose the save. Restore keeps newer work, skips conversations already running and never types into an existing terminal. Repeated Restore clicks do not start duplicate conversations.

Restored agents get fresh terminal processes in their saved panes. The previous unused shells are parked without being killed, preserving any unfinished input. They remain accessible through `hc ls` until closed or the next reboot. Occupied panes stay in place, with restored conversations opened alongside them.

Snapshots contain references, not conversation backups. The agents' own session files must remain available. Restore opens the saved conversations without submitting a new task. A failed or unsupported session is reported rather than replaced with the latest conversation.

## Install

Requires Linux, Node and herdr-core with document support. Run on each machine whose terminals you want to save:

```sh
node scripts/install.mjs
```

The installer adds the helper, Pi capture and supported integrations for installed agents. It preserves unrelated configuration and reports integrations requiring manual setup. Existing Pi panes exposing `pi.session_file` or Voice session labels can be saved immediately. Newly installed extensions and hooks apply when the agent next loads them.

Install `mod/` as `~/.config/herdr-app/mods/state/` on the viewing desktop. Add a 42-pixel block with `content: { "mod": "state" }` above the footer in a personal layout. Do not edit a shipped layout.

## Agent coverage

Resume commands follow old Herdr's 18-agent mapping. Exact identity capture is separate. Pi has native session-file capture. Command-hook agents and plugin adapters are described in [the integration guide](integrations/README.md), including installation and compatibility boundaries. OpenCode full-TUI capture is not supported without its missing selection event. Agents that cannot report an exact identity restore as shells, with a warning.

Save and Restore act on ready machines connected to the current app. Offline machines are reported and left untouched. Busy or uninspectable terminals are not disturbed. The helper also accepts `herdr-state save`, `herdr-state restore` and `herdr-state status`.

## Validation

```sh
npm run check
```

The smoke uses a disposable Core and inert fake executable. It makes no model calls and never reboots the host.
