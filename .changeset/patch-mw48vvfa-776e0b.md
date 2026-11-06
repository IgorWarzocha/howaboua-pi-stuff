---
"@howaboua/pi-shepherdr": minor
---

- Removed the older Herdr backend and SSH bridge. Requires Herdr Core 0.1.18+, Pi 1.5+ and Node.js 22.18+. Shared Notes require Notes Compaction 0.0.15+. Update and restart controllers and workers together. Start fresh Core terminals for older Herdr sessions and explicitly reselect watches when changing Core namespaces. Replace pane placement with terminal, new-tab or new-workspace placement.
- Agent calls now accept exact current Core machine names or stable IDs. Saved routes and watches survive machine renames. Connections now adds machines through `hc machine add`.
- Remote supervision and shared Notes now use a persistent Core attachment instead of SSH helpers and execution polling. Monitoring no longer depends on aggregate terminal lists that can omit slow machines.
- Shared local checkpoints remain readable after workers and intermediate controllers close, including across connected machines. Update Notes and Shepherdr together for durable cross-machine routes.
- Closed agents no longer trigger collection warnings or settlement retries during shutdown.
