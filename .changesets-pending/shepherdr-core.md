---
"@howaboua/pi-shepherdr": minor
---

Removed the legacy Herdr backend and SSH bridge. Requires Herdr Core 0.1.18+, Pi 1.5+ and Node.js 22.18+. Update and restart controllers and workers together. Start fresh Core terminals for older Herdr sessions and reselect watches when changing Core namespaces. Replace pane placement with terminal, new-tab or new-workspace placement.

- Shepherdr now runs without other extensions. Optional sharing supports Agent Comms or standalone Notes Compaction and Agent Board, preserving saved notes and boards.
- Agent calls now accept current Core machine names or stable IDs. Saved routes and watches survive renames. Connections adds machines through `hc machine add`.
- Remote supervision and sharing now use persistent Core attachments. Saved checkpoints remain readable after workers and intermediate controllers close, including older sessions across connected machines.
- Concurrent Pi sessions now share machine-local launch and saved-session read limits, with calls remaining pending until their normal result is available.
- Ordinary workers now end with their parent's program. Active remote connections enforce cross-machine cleanup. Detached workers remain independent.
- Added a public worker API with saved-session reuse and caller-selected detached lifetime.
- `/root` now follows saved spawn ancestry independently of sharing. Older workers without saved ancestry must use exact session references.
- Sending or assigning work to a closed, owned worker now resumes its saved Pi session before delivery.
- The widget now shows watched peers without repeating supervised workers. Monitoring warnings remain visible. Shells retaining old Pi labels no longer appear as live agents.
- Fixed completed replies being hidden by empty notice turns, and closed agents causing collection warnings or settlement retries.
- Agent replies now return when the extension accepts the answer instead of blocking later questions until resumed work finishes.
- Attachment and detachment now accept context or Board sharing independently. Incoming messages identify sender access, distinguishing machine IDs from Pi agent references.
- Monitoring notices now describe delayed or unavailable agent updates and automatic retry without duplicate internal errors during Core restarts.
- Agent help now asks callers to trust worker judgement instead of over-prescribing restrictions or narrowing the task unnecessarily.
- Worker profiles now brief only the initial assignment instead of pinning restrictions in the standing prompt. Later assignments and model-role changes can reuse the same agent and its notes.
