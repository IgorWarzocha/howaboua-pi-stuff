---
"@howaboua/pi-chill": patch
---

Added Pi Chill, an optional extension that folds tool activity and coordination or context notices into one compact conversation disclosure below the latest prompt or visible assistant reply with user-controlled original details. `/chill` toggles it immediately for the current session. The block shows the current tool action or reasoning heading, including nested Code and Notebook calls. It includes Shepherdr messages, Subdir Agents instructions and Codex developer, Notebook and toolkit notices. Reasoning bodies, collapsed thinking labels and exact Continue kickoff prompts hide without changing stored messages. Sender identity, worker questions, failures, errors and interruptions remain signaled in the heading without opening details. Notes-saved notices, blocking dialogs, host warnings and commentary remain visible outside the disclosure. `new_context` keeps its original call and result display as a visible boundary between separate activity groups.

Completed disclosures remain visible at their last activity position when no activity row follows the final answer.
The compact activity row shows multiple current and recent tool names, preferring nested calls over their executor. It keeps useful targets when space allows and counts omitted names on narrow screens.
