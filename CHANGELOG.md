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

### @howaboua/pi-agent-comms — 0.0.5

- Replaces standalone Notes Compaction and Agent Board. Remove the old extensions when switching. Their settings move to `pi-agent-comms.json`; saved data stays in place. Features without prior settings start off.
- Added `/board viewer` to open the read-only browser viewer directly.
- Added Conversation and Full rollover tails for notes-only `/compact` and idle rollover. Both keep conversation after the last completed Notes save on the selected branch. Full also keeps complete tool-call groups.
- Idle rollover with a tail now asks for a checkpoint when no save qualifies, then releases your original prompt and attachments.
- Settings clarify ranked history search, when pruning runs, how Notes rollovers differ from compaction, and what Board thread consolidation does.
- Code and Notebook list History alongside Notes. Notes, History and Board use compact help in every prompt mode.
- Notes help shows which fields list, search, read and write return.
- Fixed Board replies using the `reply` alias failing Notebook type checks.

[Full changelog](./packages/pi-agent-comms/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.22

- Ask always uses compact question and handoff help, including in standalone installs.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.15

- Skills lists trusted repository `.agents/skills` under Session alongside `.pi/skills`, without duplicates. Global `~/.agents/skills` are excluded.
- Skills always uses compact discovery and reading guidance, including in standalone installs.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.15

- Browser settings clarify which listed host runs locally and where to set the Node.js executable for SSH hosts.
- Browser always uses compact tool help, including in standalone installs.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-chatgpt-sites — 0.0.6

- Added `site.open` to restore an existing Site's committed source into a new local checkout without publishing.
- Fixed saving source with Sites access tokens or an authenticated Work proxy.
- Fixed private deployments for accounts without a shared deployment route.
- Updated the Sites guides for building, access, and connecting Site-hosted MCP tools.
- Sites always uses compact guide and schema discovery, including in standalone installs.

[Full changelog](./packages/pi-chatgpt-sites/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 5.1.0

- Removed Voice only mode. Existing settings follow Provider scope. Use GipPity Control for voice without the Codex adapter.
- Removed the Extra tools only scope and standalone `apply_patch` and `view_image` switches. Existing Extra tools only settings switch to Codex and configured providers. Both tools remain available through the adapter.
- Removed Deno Notebook. Existing settings select TS Notebook without importing Deno state. [Recover or remove old notebook files](https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/main/docs/deno-to-ts-notebook.md).
- Replaced QuickJS Code with VM Code. Existing settings select VM Code, which keeps JavaScript bindings across cells. Select Code for fresh cells. VM Code runs on Linux, macOS and Windows. On Linux with Bun it requires a systemd user session and cgroup v2.
- Removed the Harness identifier setting. Codex requests always use `codex_cli_rs` as the originator.
- Replaced Compact tool output and Code / Notebook details with one Tool details setting: Minimal, Compact or Preview. Expand tool rows to see their available source, output and diffs.
- Heavy system prompt overwrite is now Off or On. On uses the former GPT mode.
- Older global and trusted project settings are migrated once without overwriting unrelated fields. Legacy Notes continuity notices now point to Agent Comms.
- Codex switches to HTTP for the session when it detects a WebSocket size limit before text appears. If a size rejection follows visible text, Codex reports the incomplete response without replaying it.
- Folded shell rows distinguish errors from searches with no matches. Background completion notices collapse to one line, and expanded cells show identical shell output only once.
- Code and Notebook group exact usage calls. `ALL_TOOLS` lists every public tool available to the cell.
- Code and Notebook guidance recommends composing related calls in one cell and checking JavaScript syntax before sending. VM Code and TS Notebook explain how to recover from redeclaring a binding.
- TS Notebook resolves packages and type roots more reliably.
- Code and Notebook print plain shell output by default. Existing choices are preserved. To opt out, set `notebook.plainCommandOutput` to `false` in `pi-codex-conversion.json`.
- Auto Reasoning recommends adjusting effort when the work phase changes or a task turns out harder or easier than expected.
- Codex puts tool instructions before workspace context and directs agents to act on clear requests and work through recoverable blockers.
- Updated the bundled Codex tools and voice helpers.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-guardian — 0.0.1

- Initial release of Codex Guardian approval reviews for Pi.
  - Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
  - AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
  - Use `/guardian` to inspect status, enable or disable protection, and reload rules.

  Installed separately from the extension bundles. Review requests are not confirmed to be free.

[Full changelog](./packages/pi-codex-guardian/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.17

- Image generation settings clarify when Codex uses the current model’s provider and when a separate Codex login or API credentials are needed.
- Image generation always uses compact discovery and tool help, including in standalone installs.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.13

- Web activity rows distinguish searches, opened pages and links, and in-page finds. Batched and mixed requests show how many actions were requested.
- Web Run always uses compact search and reference guidance, without requiring Pi Codex Conversion.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.110

- Include bundled package updates:

  - @howaboua/pi-ask: Ask always uses compact question and handoff help, including in standalone installs.
  - @howaboua/pi-better-skills-tool: - Skills lists trusted repository `.agents/skills` under Session alongside `.pi/skills`, without duplicates. Global `~/.agents/skills` are excluded. - Skills always uses compact discovery and reading guidance, including in standalone installs.
  - @howaboua/pi-gippity-control: - GipPity settings explain how browser access, dropped-call recovery and voice context refresh work. - Bundled voice helpers use updated Rust dependencies.
  - @howaboua/pi-github-watch: GitHub Watch always uses compact watch help, including in standalone installs.
  - @howaboua/pi-shepherdr: - Shared Notes and Board recovery messages direct users to Agent Comms. - Shepherdr settings distinguish delegation guidance from starting workers and explain what adding an SSH connection does. - Agent discovery shows and accepts the local Herdr Core name. For remote machines, use the label or ID from `list`, not the hostname. - Agent help uses compact wording and separates terminal commands from Herdr window controls.
  - @howaboua/pi-unicode-charts: Chart instructions always use the compact format. Pi Codex Conversion is no longer needed to select it.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.34

- GipPity settings explain how browser access, dropped-call recovery and voice context refresh work.
- Bundled voice helpers use updated Rust dependencies.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-github-watch — 0.0.9

- GitHub Watch always uses compact watch help, including in standalone installs.

[Full changelog](./packages/pi-github-watch/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.7

- Requires Pi 1.5 or newer.

  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

  - `/sol` and `/astra` now select GPT-6.2 Sol and Astra, including without Codex Conversion.
  - Context defaults are now 500K for Sol, Terra and Luna, and 256K for Astra. Existing preferences are preserved.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-grok-realtime — 0.0.8

- Grok settings explain how the access selection matches Pi’s active xAI credential, and when voice context summaries and follow-ups are used.

[Full changelog](./packages/pi-grok-realtime/CHANGELOG.md)

### @howaboua/pi-observatory — 0.0.6

- The investigation guide distinguishes read-only evidence gathering from starting the viewer or collectors.

[Full changelog](./packages/pi-observatory/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.10

- The pet authoring guide clarifies reference-image requirements and when generation jobs are complete.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-sandbox — 0.1.7

- Sandbox command waits use fewer guest processes to check whether a command has finished.
- Sandbox help clarifies command wait timeouts and warns against secrets in templates or setup commands.

[Full changelog](./packages/pi-sandbox/CHANGELOG.md)

### @howaboua/pi-shepherdr — 1.0.4

- Shared Notes and Board recovery messages direct users to Agent Comms.
- Shepherdr settings distinguish delegation guidance from starting workers and explain what adding an SSH connection does.
- Agent discovery shows and accepts the local Herdr Core name. For remote machines, use the label or ID from `list`, not the hostname.
- Agent help uses compact wording and separates terminal commands from Herdr window controls.

[Full changelog](./packages/pi-shepherdr/CHANGELOG.md)

### @howaboua/pi-skill-chrome-cdp — 0.0.5

### Changes

- [#342](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/342) [`35182d9`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/35182d9a002daded7610cca64c47b25bed3267df) Thanks [@howaclawa](https://github.com/howaclawa)! - Give Chrome CDP agents bounded snapshots and screenshots with non-aliasing reusable element references, broader ARIA control support, targeted search, serialized daemon commands, released remote object handles, revalidated native clicks, identity-safe referenced-field input, Shadow DOM support, actionable timeout recovery, and reliable linked CLI execution.

[Full changelog](./packages/pi-skill-chrome-cdp/CHANGELOG.md)

### @howaboua/pi-skill-code — 0.0.4

- Removed the manual Codex PR review request template from repository-delivery guidance.

[Full changelog](./packages/pi-skill-code/CHANGELOG.md)

### @howaboua/pi-skill-foundations — 0.0.3

- Communication guidance now uses a shorter baseline, rejects stock banter and checks apparent contradictions before conceding a mistake.

[Full changelog](./packages/pi-skill-foundations/CHANGELOG.md)

### @howaboua/pi-skill-harness-and-agent-engineering — 0.0.8

- Pi extension guidance now recommends native schema builders and validation.

[Full changelog](./packages/pi-skill-harness-and-agent-engineering/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.6

- Expanded Omarchy guidance for personalization, maintenance, recovery, Bluetooth, crashes, and runtime triage.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.27

- Include bundled package updates:

  - @howaboua/pi-skill-harness-and-agent-engineering: Pi extension guidance now recommends native schema builders and validation.

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.118

- Include bundled package updates:

  - @howaboua/pi-ask: Ask always uses compact question and handoff help, including in standalone installs.
  - @howaboua/pi-better-skills-tool: - Skills lists trusted repository `.agents/skills` under Session alongside `.pi/skills`, without duplicates. Global `~/.agents/skills` are excluded. - Skills always uses compact discovery and reading guidance, including in standalone installs.
  - @howaboua/pi-gippity-control: - GipPity settings explain how browser access, dropped-call recovery and voice context refresh work. - Bundled voice helpers use updated Rust dependencies.
  - @howaboua/pi-github-watch: GitHub Watch always uses compact watch help, including in standalone installs.
  - @howaboua/pi-shepherdr: - Shared Notes and Board recovery messages direct users to Agent Comms. - Shepherdr settings distinguish delegation guidance from starting workers and explain what adding an SSH connection does. - Agent discovery shows and accepts the local Herdr Core name. For remote machines, use the label or ID from `list`, not the hostname. - Agent help uses compact wording and separates terminal commands from Herdr window controls.
  - @howaboua/pi-unicode-charts: Chart instructions always use the compact format. Pi Codex Conversion is no longer needed to select it.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.10

- Updates use Pi's native changelog notices and `collapseChangelog` instead of custom suppression.
- Nested AGENTS.md guidance is saved once per delivery without duplicating its text in session metadata.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-suggestions — 0.0.4

- Disabled suggestions no longer scan conversation history. Enabled suggestions scan it once per request.
- Suggestion requests no longer repeat the draft instruction on every turn.

[Full changelog](./packages/pi-suggestions/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.6

- Chart instructions always use the compact format. Pi Codex Conversion is no longer needed to select it.

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

