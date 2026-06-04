Codex repo contains reference files for comparing the extension. Local path: `/home/igorw/Frameworks/codex`.
We are working on a Pi extension that converts Pi to as close as possible to Codex's toolkit.

Release note: publishing now runs through GitHub Actions. Do not attempt `npm publish` from the agent. Prepare, validate, commit, tag, and push releases so the workflow can publish them.

Before npm publish readiness or a merge only when the user explicitly says we are ready for npm/publish/release: do a final OpenAI Codex provider compatibility pass. Compare `src/providers/openai-codex-custom-provider.ts` against Pi's bundled stock `openai-codex-responses` provider for request shape, transport/header behavior, reasoning/service-tier handling, retry/stream terminal semantics, and any newly changed code. Explicitly call out intentional divergences (web/image surfacing, image saving, activity messages, extra web-search includes) and do not accept review-bot suggestions that move us away from stock Pi behavior unless verified against the ChatGPT Codex backend or clearly intentional.
