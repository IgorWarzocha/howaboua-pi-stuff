# Changelog

## 0.0.1

Initial monorepo release for the Howaboua Pi package collection.

This repository brings the previously separate Pi packages into one Bun workspace while keeping every package separately installable. It also adds aggregate packages for installing everything, extensions only, or skills only:

- `@howaboua/pi-stuff`
- `@howaboua/pi-extensions`
- `@howaboua/pi-skills`

Legacy Pi Codex history remains in its [package changelog](./packages/pi-codex-conversion/CHANGELOG.md).

Going forward, package-level changelogs remain the source of truth for each package, and this top-level changelog summarizes monorepo-wide releases.

<!-- package-changelog-summary -->

## Latest package changelogs

### @howaboua/pi-ask — 0.0.9

- Removed redundant tool guidance from Ask, Shepherdr, Skills and Browser. Code and Notebook Mode now show one callable contract per tool, with detailed Browser and agent rules in help.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.16

- GPT-6 Sol and Luna now share Astra's Codex support.

  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.5

- Skills tool usage now advertises category-filtered listing in Code and Notebook modes.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.5

- Browser snapshots now include link destinations.

  - Browser help and schemas now describe single-action requests, shared batch fields and JSON results with less repetition.
  - Click errors now identify zero-sized browser viewports.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 3.0.40

- Added independent context controls, opt-in agent sharing and persistent Codex usage tracking.

  - Added GPT-6.1 Sol with Responses Lite, native reasoning updates, published API pricing and a 272K default context window. Supported reasoning levels run from `low` through `max`, without `off` or `minimal`.
  - `/codex context` now separates continuity, Local, Tree or Remote storage, and Pi summary, Codex V2 or Both compaction. Existing settings migrate automatically, and strategy changes preserve the current conversation and usable checkpoints.
  - Added shared notes and history for newly spawned agents through Shepherdr or compatible extensions. Sharing is off by default.
  - Shepherdr wakeups of existing agents now say “Continue, unless awaiting for user approval.” Fresh-agent startup and context rollover are unchanged.
  - Notes-based continuity now asks agents to write final notes as their last tool calls before reporting meaningful task results, with note paths in replies to other agents.
  - Notes-only `/compact` now reuses fresh notes or requests a note-saving run, including when first used on a resumed session, then opens a new window without starting another turn.
  - `/codex usage` now shows API-equivalent spend and tokens by model and reset window, estimated quota shares, and spend-rate comparisons with the previous window and month. A one-time local-history import seeds initial estimates, with incomplete coverage kept visible.
  - Added tracking for renamed Codex providers, including usage reported by failed requests. Usage and reset requests follow configured endpoints and headers, with an accuracy warning for nonstandard configurations.
  - Added `/codex usage analyse` for read-only long-term trends and session-based reasoning reports.
  - Codex requests now honor server retry deadlines within the three-minute recovery limit, stop on unavailable Flex capacity and skip redundant warmups on ready WebSockets.
  - Harness identifier header now offers Pi, Pi Codex Conversion and Codex identities. Pi remains the default.
  - Code and Notebook modes automatically expose Pi 0.99.1 MCP tools and resources through `tools` and `ALL_TOOLS`, preserving Pi permissions and full MCP results. Ordinary extensions still opt in separately; Pi's built-in `codemode` is disabled while these modes are active and restored afterward.
  - Deferred tools now announce their names and short descriptions at startup, with incremental availability updates when tools change and a fresh inventory after context rollover.
  - Notebook startup status and deferred-tool notices now show compact state and tool-count summaries in Pi's theme, expand with Ctrl+O and toggle individually when clicked in fullscreen mode.
  - Fixed acceptance of incomplete or ambiguous Responses tool calls.
  - Fixed Fast Mode cost estimates when the backend reports the `fast` tier.
  - Failed browser login callbacks now stop promptly and show the provider error.
  - Codex stream events now reach Pi extensions on HTTP and WebSocket transports, without retrying generation when an observer fails.
  - Responses streams now preserve provider-supplied readable reasoning and content-part order. Voice reasoning updates forward only verified summaries, never raw reasoning.
  - Structured, Code and Notebook modes now use shorter instructions and tool schemas. Skill catalogs no longer use Codex-prefixed tags or redundant headings. Bundled reviewer prompts request findings without issue-count targets.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.8

- Added `transparent_background` for generated and edited images. Omitted or false requests an opaque background.

  Image requests now re-evaluate proxy and `no_proxy` routing after redirects.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.5

- Web requests now re-evaluate proxy and `no_proxy` routing after redirects.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-dynamic-tools — 0.0.9

- Reviewer prompts now request evidence-backed findings without issue-count targets.

[Full changelog](./packages/pi-dynamic-tools/CHANGELOG.md)

### @howaboua/pi-explore-subagents — 0.1.15

- Explorer prompts now use concise evidence maps and explicit unknowns without fixed-length report templates or repeated discovery instructions.

[Full changelog](./packages/pi-explore-subagents/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.82

- Include bundled package updates:

  - @howaboua/pi-shepherdr: Agent profiles now control delegation waiting and shared context. - Removed reviewer-name blocking rules. Optional profile `blocking` forces blocking or asynchronous spawns, and help and list report the configured policy with the profile description. - Added `share_context: false` for independent subagent notes and history. Existing installed profiles remain unchanged.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.23

- Fixed `voice.forwardReasoningSummaries` forwarding raw reasoning. Voice now uses only verified provider summaries and preserves visible-text progress.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.4

- The `/sol` shortcut now selects GPT-6.1 Sol while preserving configured context and reasoning defaults.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-memories — 0.1.5

- Memory extraction now uses supplied context without assuming that global or project instruction files were loaded.

[Full changelog](./packages/pi-memories/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.4

- Remove obsolete test-only helper exports without changing tool behavior.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-semantic-grep — 0.1.19

### Changes

- [#239](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/239) [`7dbbfc8`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/7dbbfc8bc28746ec28b3142a73efc8e0b14d2ffa) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Make indexing non-blocking at session startup.
  - Use a single writer with atomic, resumable rebuilds.
  - Respect ignore rules and prioritize metadata, batching, and roles.
  - Preserve usable prior indexes across interrupted rebuilds.

[Full changelog](./packages/pi-semantic-grep/CHANGELOG.md)

### @howaboua/pi-shepherdr — 0.2.8

- Agent profiles now control delegation waiting and shared context.

  - Removed reviewer-name blocking rules. Optional profile `blocking` forces blocking or asynchronous spawns, and help and list report the configured policy with the profile description.
  - Added `share_context: false` for independent subagent notes and history. Existing installed profiles remain unchanged.

[Full changelog](./packages/pi-shepherdr/CHANGELOG.md)

### @howaboua/pi-skill-chrome-cdp — 0.0.5

### Changes

- [#342](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/342) [`35182d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/35182d9a002daded7610cca64c47b25bed3267df) Thanks [@howaclawa](https://github.com/howaclawa)! - Give Chrome CDP agents bounded snapshots and screenshots with non-aliasing reusable element references, broader ARIA control support, targeted search, serialized daemon commands, released remote object handles, revalidated native clicks, identity-safe referenced-field input, Shadow DOM support, actionable timeout recovery, and reliable linked CLI execution.

[Full changelog](./packages/pi-skill-chrome-cdp/CHANGELOG.md)

### @howaboua/pi-skill-code — 0.0.3

- Scratchpad guidance now keeps one-off checks temporary and deletes their artifacts after use. Persistent projects require an explicit request to retain them.

[Full changelog](./packages/pi-skill-code/CHANGELOG.md)

### @howaboua/pi-skill-foundations — 0.0.3

- Communication guidance now uses a shorter baseline, rejects stock banter and checks apparent contradictions before conceding a mistake.

[Full changelog](./packages/pi-skill-foundations/CHANGELOG.md)

### @howaboua/pi-skill-harness-and-agent-engineering — 0.0.4

- Harness skills now use shorter, evidence-led guidance.

  - Extension design now selects validation by the changed behavior and reuses existing measurement tools for wording edits.
  - Instruction calibration now checks one-shot outputs against current APIs, distinguishes instruction size from task-cost savings, and completes delegated evaluations without approval between probes.
  - Prompt-caching guidance now starts from the affected transition and provider-reported usage.
  - Tool-design guidance now requires a retrieval path for potentially needed truncated output.

[Full changelog](./packages/pi-skill-harness-and-agent-engineering/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.6

- Expanded Omarchy guidance for personalization, maintenance, recovery, Bluetooth, crashes, and runtime triage.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.22

- Include bundled package updates:

  - @howaboua/pi-skill-foundations: Communication guidance now uses a shorter baseline, rejects stock banter and checks apparent contradictions before conceding a mistake.
  - @howaboua/pi-skill-harness-and-agent-engineering: Harness skills now use shorter, evidence-led guidance. - Extension design now selects validation by the changed behavior and reuses existing measurement tools for wording edits. - Instruction calibration now checks one-shot outputs against current APIs, distinguishes instruction size from task-cost savings, and completes delegated evaluations without approval between probes. - Prompt-caching guidance now starts from the affected transition and provider-reported usage. - Tool-design guidance now requires a retrieval path for potentially needed truncated output.

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.8

- GPT-6 Sol and Luna now share Astra's Codex support.

  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.90

- Include bundled package updates:

  - @howaboua/pi-shepherdr: Agent profiles now control delegation waiting and shared context. - Removed reviewer-name blocking rules. Optional profile `blocking` forces blocking or asynchronous spawns, and help and list report the configured policy with the profile description. - Added `share_context: false` for independent subagent notes and history. Existing installed profiles remain unchanged.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.25

- Reviewer prompts now request evidence-backed findings without issue-count targets.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.9

- Expanded AGENTS.md notices now use the same muted theme colour as their summaries.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.0

### Changes

- [#295](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/295) [`b3c662a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/b3c662abe45472e7b720cc900421164e1f137ee6) Thanks [@howaclawa](https://github.com/howaclawa)! - Add terminal-native Unicode bar, line, scatter, sparkline, and heatmap rendering for explicit `chart` Markdown blocks

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

### @howaboua/pi-vent — 0.2.11

- Vent now uses shorter tool guidance for recording repeated workflow friction after completing the task.

[Full changelog](./packages/pi-vent/CHANGELOG.md)

