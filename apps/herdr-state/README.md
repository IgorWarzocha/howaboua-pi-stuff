# Herdr State

Save the coding-agent conversations open in Herdr, then restore them after a reboot. The sidebar has two buttons: **Save** and **Restore**. Nothing watches for shutdowns or polls for changes.

Save records spaces, tabs, splits, folders and exact native session references, including background agents without a visible pane. Each machine stores its own snapshot in its Core state, so closing the viewing desktop does not lose the save. Restore inventories the fleet before starting anything. Conversations already running on any reachable machine stay where they are. Newer work and unfinished input are preserved, and repeated Restore clicks do not start duplicate conversations.

Saved native parent links are restored parent-first, with their saved lifetime choices passed to Core. Cross-machine children launch through their parent's Core, never through a terminal with the same number on another computer. Both Cores need routes to each other. A missing parent or route is reported and leaves the child untouched. Older snapshots remain readable but cannot recover ancestry they never recorded.

Core 0.1.18 did not stop a cross-machine child when its restored parent ended during validation, despite the correct native parent link and lifetime flag. State reports this limitation when launching such a child. Close the child explicitly if its parent ends. State does not add a watcher or silently detach it.

Restored agents get fresh terminal processes in their saved panes. The previous unused shells are parked without being killed, preserving any unfinished input. They remain accessible through `hc ls` until closed or the next reboot. Occupied panes stay in place, with restored conversations opened alongside them.

Snapshots contain references, not computer or conversation backups. The agents' own session files must remain available on their saved machine. Restore opens the saved conversations without submitting a new task. A failed or unsupported session is reported rather than replaced with the latest conversation. Pi conversations are compared by their native session IDs when their file headers are readable, so different paths to the same conversation do not cause another launch.

## Install

### On each machine running agents

Requires Linux with `/proc`, Node.js and herdr-core (`hc`) with the `doc.get` and `doc.set` APIs. Use a current Node.js LTS release. Node and `hc` must be available to the agent integrations. Install Herdr and Core separately before continuing. Kimi's automatic hook installation also needs Python 3.11 or newer. Other agent-specific requirements are in [the integration guide](integrations/README.md).

Choose a permanent location for this checkout on each machine whose terminals you want to save:

```sh
git clone https://github.com/IgorWarzocha/howaboua-pi-stuff.git
cd howaboua-pi-stuff/apps/herdr-state
node scripts/install.mjs
```

If you already have the repository, change into its `apps/herdr-state` directory instead. No dependency installation or build is needed.

This is a source-linked installation, not a standalone copy. Keep the source tree and the Node executable used for installation available at their installed paths. The helper and command hooks contain absolute paths, and extension links load files from this checkout. See [Moving the installation](#moving-the-installation) before relocating either.

The installer adds `~/.local/bin/herdr-state`, Pi capture and supported integrations for agents whose executables pass `--version`. It preserves unrelated configuration. Read its JSON report: `installed` lists installed or already-current entries, while `skipped` and `warnings` explain missing agents, conflicts and manual setup. A successful exit does not mean every integration was installed. Resolve the relevant warnings using the integration guide.

Make sure `~/.local/bin` is on the PATH inherited by the running Core, not just your current terminal. Add it to your shell or service environment as appropriate:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

That export does not change an already-running Core's environment. Verify what Core can find with this read-only check:

```sh
hc exec sh -c 'command -v herdr-state && command -v hc'
```

Both commands should print executable paths. If they do not, correct the environment used to launch Core before using State. Existing Pi panes exposing `pi.session_file` or Voice session labels can be saved immediately. Newly installed extensions and hooks apply when the agent next loads them.

### On the viewing desktop

The viewing desktop needs Herdr with mod and personal-layout support. Copy the whole `mod/` directory from this checkout into its app home. If the checkout is on another machine, transfer that directory to the desktop first. Run the following from the directory containing `mod/`, normally `apps/herdr-state`:

```sh
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mkdir -p "$app_home/mods/state"
cp -R mod/. "$app_home/mods/state/"
herdr-app check "$app_home/mods/state"
```

The default app home is `~/.config/herdr-app`. For a custom location, set `HERDR_APP_HOME` to that path for both the running app and these commands. The desktop mod is a separate installed copy. Copy it again on every viewing computer when updating State. Source edits alone do not update those copies.

Do not edit a shipped layout. Herdr replaces shipped layouts on startup. With the app running, create a personal copy of `main`:

```sh
herdr-app do layout.clone --name main --as personal-state
```

This creates `layouts/personal-state.json` in the app home and switches to it. If that personal layout already exists, use it instead of cloning again. Edit that file and insert the following complete node into the `sidebar` node's `children` array, immediately before `sidebar-footer`. Separate adjacent array entries with commas.

```json
{
  "id": "state",
  "type": "block",
  "size": { "px": 42 },
  "content": { "mod": "state" }
}
```

Save the file. Herdr reloads layout edits automatically. To activate the layout again later, run:

```sh
herdr-app do layout.switch --name personal-state
herdr-app status
```

Check that the State controls appear above the sidebar footer and that `status` reports no layout or mod errors. Hover over the icons for **Save** and **Restore**. Save records the current conversations. Restore reopens the saved conversations when you need them, without submitting a task.

## Moving the installation

Rerunning the installer alone does not repair a move. It preserves existing symlinks that point elsewhere and appends changed hook entries rather than removing obsolete ones.

1. Put the complete source tree in its new permanent location and choose the Node executable you will keep available. Inspect the previous installer report and the agent configuration locations in the integration guide.
2. Inspect each State extension or plugin link with `ls -l` or `readlink`. Retarget only links you have verified point into the old State tree. These can include Pi and OMP's `extensions/herdr-state.ts`, OpenCode and Kilo's `plugin/herdr-state.js`, and the manually installed Hermes `plugins/herdr-state` directory link. Do not replace unrelated files or links. For an individual verified link, remove that link, not its target, then recreate it pointing at the corresponding file or directory in the new tree.
3. In each affected agent configuration, remove or update only State's obsolete hook entries. Identify them by the old absolute `src/capture.mjs` path and Node path. Keep other hooks and settings intact. From the new `apps/herdr-state` directory, `node integrations/hooks.mjs claude` prints the replacement fragment for Claude. Substitute the relevant agent name from the integration guide. Also update any manually registered absolute plugin paths or re-export wrappers. Shared Codex hooks that call the unchanged `~/.local/bin/herdr-state` helper do not need a source-path edit.
4. Run `node scripts/install.mjs` from the new `apps/herdr-state` directory using the intended Node executable. It refreshes its own marked helper wrapper and installs missing entries. Inspect `installed`, `skipped` and `warnings` again. Resolve conflicts rather than deleting another tool's configuration.
5. Check that State links and hook commands no longer reference the old source or Node paths, repeat the Core PATH check above, and let the agents reload their integrations. Keep native session files available. The viewing desktop's copied mod does not need retargeting when the source moves.

## Agent coverage

Restore supports native resume commands for 18 coding agents. Capturing their exact session identities requires the appropriate integration. Pi has native session-file capture. Command-hook agents and plugin adapters are described in [the integration guide](integrations/README.md), including installation and compatibility boundaries. OpenCode full-TUI capture is not supported without its missing selection event. Agents that cannot report an exact identity restore as shells, with a warning.

Save and Restore use the initiating Core's machine catalogue, including machines whose layout has not loaded in the viewing window. Configure those routes with `hc machine add` and install the same State version on each computer. An app-listed machine missing from that catalogue is reported, not silently omitted. Each machine reads its own layout and snapshot from its Core. Remote panes in another machine's layout are not relaunched locally.

Results identify each machine and restored terminal. Save continues on reachable machines if another is unavailable, preserving the unavailable machine's previous snapshot. Restore still recognises existing conversations, but defers new native launches while any fleet inventory is inaccessible. It cannot safely rule out a duplicate on an unseen machine. Restore also defers a conversation whose previous terminal is busy or uninspectable without a verified native identity. Resolve the reported problem and click Restore again. No terminal input is sent.

The helper accepts `herdr-state save` and `herdr-state restore` for the configured fleet. `herdr-state status` reports the local snapshot. Machine-operation errors produce a nonzero exit status. Per-terminal recovery problems are included in the JSON warnings and sidebar notification, so inspect those results even when the exit status is zero.

## Validation

```sh
npm run check
```

The smoke uses a disposable Core and inert fake executable. It makes no model calls and never reboots the host.
