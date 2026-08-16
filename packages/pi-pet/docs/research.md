# Codex pet evidence

Research performed 2026-07-18 before implementation.

## Verified locally

The supplied evidence pack was read from the desktop at:

```text
/home/igorw/Documents/Codex/2026-07-18/hatch-pet-home-igorw-codex-skills
```

Its contract and validated Clawa fixture establish the Codex-v2 `1536x2288`, 8×11, `192x208` atlas; nine standard action rows; sixteen clockwise look directions; and the minimal `pet.json` package. Clawa's retained validation reports no errors or warnings.

Pi's installed documentation verifies:

- long-lived extension resources start at `session_start` and close at `session_shutdown`;
- `agent_settled` is the reliable completion event;
- parallel tool execution events can interleave;
- `pi.sendUserMessage` injects a real user message and requires `steer` or `followUp` while busy;
- one package can declare both extensions and skills.

Relevant local docs: `docs/extensions.md`, `docs/skills.md`, `docs/packages.md`, and `docs/rpc.md` in the installed `@earendil-works/pi-coding-agent` package.

## Web findings

- OpenAI's public Hatch Pet skill confirms deterministic spritesheet creation, validation, visual QA, and `pet.json` packaging: <https://github.com/openai/skills/tree/main/skills/.curated/hatch-pet>
- OpenAI Codex issue #20863 documents that current animation timing, chaining, and activity triggers are hardcoded rather than pet-manifest driven: <https://github.com/openai/codex/issues/20863>
- OpenAI Codex issue #21657 requests click/hover/drag hooks and first-party actions, indicating those interaction APIs are not currently available: <https://github.com/openai/codex/issues/21657>

The browser-to-Pi prompt bridge is therefore a Pi-native addition, not a claim of Codex feature parity. The reusable product idea is the state-driven companion; this implementation deliberately uses Pi's documented extension surface rather than Codex desktop internals.
