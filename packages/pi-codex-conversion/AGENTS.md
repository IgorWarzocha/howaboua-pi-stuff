# pi-codex-conversion rules

- Goal: make Pi behave as close as practical to Codex's toolkit.
- Reference Codex repo for comparisons: `/home/igorw/Frameworks/codex`.
- When explicitly preparing npm/publish/release/merge, compare `src/providers/openai-codex-custom-provider.ts` against Pi's stock `openai-codex-responses` provider.
- Compatibility pass covers request shape, transport/headers, reasoning/service-tier handling, retry/stream terminal semantics, and touched code.
- Call out intentional divergences: web/image surfacing, image saving, activity messages, extra web-search includes.
- Do not accept review-bot drift from stock Pi behavior unless backend-verified or intentional.
