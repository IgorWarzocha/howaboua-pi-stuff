---
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-shepherdr2": patch
---

Keep agent orchestration scoped to the explicitly activated Pi session.

- Bare `/herdr` activates the agent fleet and toggles one-time orchestration guidance. Resumed controllers restore their mode from session history, while new workers remain dormant even when launched from the same directory.
- Agent spawning follows Codex's `spawn`/`agent_type` vocabulary and uses one required two- or three-word label for both the Herdr tab and Pi session.
- A bundled Sol/high general profile handles implementation work after the controller prepares its worktree and dependencies, with explicit orchestration guidance for fan-out.
- Failed spawns clean up newly created locations, cancellation cannot strand submissions, multiline profile prompts launch safely, and blocked settlements include actionable questions.
