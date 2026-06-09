# pi-codex-conversion rules

- Goal: make Pi behave as close as practical to Codex's toolkit.
- Reference Codex repo for comparisons: `/home/igorw/Frameworks/codex`.
- When explicitly preparing npm/publish/release/merge, compare `src/providers/openai-codex-custom-provider.ts` against Pi's stock `openai-codex-responses` provider.
- Compatibility pass covers request shape, transport/headers, reasoning/service-tier handling, retry/stream terminal semantics, and touched code.
- PATH mode structured tool surface is only `exec_command` + `write_stdin`; Codex extras live on PATH.
- PATH tools: `apply_patch`, `view_image`, `web_run`, `imagegen`.
- PATH tool build notes live in `PATH_TOOLS.md`.
- Keep prompt guidance short and argv-shaped. Normal mode uses flat TS tools; PATH mode uses shell commands.
- Call out intentional divergences: PATH web/image tools are local wrappers around Codex-backed requests, not provider-native function tools.
- Do not accept review-bot drift from stock Pi behavior unless backend-verified or intentional.
