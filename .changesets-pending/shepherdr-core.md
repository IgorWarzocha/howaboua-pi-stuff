---
"@howaboua/pi-shepherdr": minor
---

- Removed the older Herdr backend and SSH bridge. Requires Herdr Core 0.1.18+, Pi 1.5+ and Node.js 22.18+. Update and restart controllers and workers together. Start fresh Core terminals for older Herdr sessions and explicitly reselect watches when changing Core namespaces. Replace pane placement with terminal, new-tab or new-workspace placement.
- Shared Notes and Board now use Agent Comms. Replace the separate Notes Compaction and Agent Board extensions in participating sessions; saved notes and boards are preserved.
- Agent calls now accept exact current Core machine names or stable IDs. Saved routes and watches survive machine renames. Connections now adds machines through `hc machine add`.
- Remote supervision and shared Notes now use a persistent Core attachment instead of SSH helpers and execution polling. Monitoring no longer depends on aggregate terminal lists that can omit slow machines.
- Shared local checkpoints remain readable after workers and intermediate controllers close, including older sessions across connected machines.
- Closed agents no longer trigger collection warnings or settlement retries during shutdown.
- Concurrent Pi sessions now share machine-local limits for agent launches and saved-session reads. Tool calls still return their normal results after the operation completes.
- The widget now shows watched peers without repeating supervised workers. Monitoring warnings remain visible, and worker reports and controls are unchanged.
