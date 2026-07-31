# Pi-Codex system prompt

- Core construction has one owner: `build-system-prompt.ts`. Prompt wording, section order, guidelines, skills, shell context, and heavy-overwrite behavior belong there.
- Call path: `extension/events.ts` `before_agent_start` → `runtime.codexSystemPrompt()` → `buildCodexSystemPrompt()`. Events route; runtime selects mode/config; neither rebuilds prompt text.
- Code Mode inserts its dynamic tool section under `tools/code-mode/` before this builder runs. Keep that narrow exception there.
- Provider code may serialize or capture final instructions but must not author prompt text. Later Pi extensions may still mutate the prompt; inspect the final provider payload when exact sent instructions matter.
- Keep construction deterministic and cache-stable.
