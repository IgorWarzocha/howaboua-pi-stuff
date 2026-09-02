---
"@howaboua/pi-shepherdr": patch
---

Replace Shepherdr's original fire-and-forget tool with persistent blocking and asynchronous agents in normal Pi, Code Mode and Notebook Mode.

- Bare `/herdr` activates the agent fleet and toggles one-time orchestration guidance. Resumed controllers restore their mode from session history, while new workers remain dormant even when launched from the same directory.
- Agent spawning follows Codex's `spawn`/`agent_type` vocabulary and uses one required two- or three-word label for both the Herdr tab and Pi session.
- Editable general, explorer and reviewer profiles are installed on first load. Users can add, change or remove agent types, while orchestration guidance follows whether the general profile exists.
- Failed spawns clean up newly created locations, cancellation cannot strand submissions, multiline profile prompts launch safely, and blocked settlements include actionable questions.
