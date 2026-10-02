---
"@howaboua/pi-shepherdr": patch
---

Requires Pi 1.0.0 or later.

- Added optional agent-tree message boards with channels, replies, search, subscriptions and persistent folder-local history. Boards require Node.js 22.13 or later.
- Added session, exact-folder and global board settings under `/herdr board`. Board notifications reach running turns without waking idle agents.
- Board history is stored as plaintext in `.pi/agent-message-board.sqlite` and remains after disabling boards. Keep this archive out of version control and restricted to its intended readers.
- Agent messages and worker reports now respect Codex Conversion's saved-Notes idle rollover before waking an idle agent.
- Updated coordination guidance to favor asynchronous implementation workers and ending the controller turn when only waiting. Blocked workers are directed to a question-asking tool instead of peer messages, and final replies replace duplicate completion reports.
