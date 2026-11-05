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

### @howaboua/pi-agent-board — 0.0.5

- Requires Pi 1.5 or newer.

  - Board agents now use Pi session IDs without changing identity on attachment. Existing authors, subscriptions and archives remain accessible.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-agent-board/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.18

- Requires Pi 1.5 or newer.

  - Waiting prompts now report Pi's native blocked state. Steering prompts remain non-blocking.
  - Invalid question arguments now explain how to find the supported format.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-auto-trees — 0.1.19

- GPT mode uses note-style priming, commit-summary and voice guidance.

[Full changelog](./packages/pi-auto-trees/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.12

- - Skills now shows its exact discovery call in Code and Notebook modes and clarifies batch-read syntax in help.
  - GPT mode uses note-style skill discovery and reading guidance.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.13

- Fixed npm-installed Pi Browser blocking startup when Pi Codex Conversion is installed.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-chatgpt-sites — 0.0.3

- - Sites calls now return their payload directly instead of an outer `result` wrapper.
  - Errors show the problem and recovery information without diagnostic envelopes.
  - GPT mode uses note-style guide and schema discovery.

[Full changelog](./packages/pi-chatgpt-sites/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 4.0.8

- Requires Pi 1.5 or newer.

  Custom voice-helper overrides must be rebuilt. Bundled helpers update with the package.

  - Reduced parsing overhead for large streamed tool calls.
  - Code and Notebook now preserve declared structured results and apply native tool argument preparation once.
  - Code and Notebook guidance now separates help discovery from calls using unknown arguments and distinguishes printing from return values.
  - TS execution now uses tsrs 0.21.0 with TypeScript 7.1 beta.
  - GPT-6.1 Terra, GPT-6 Sol and GPT-6 Luna now support reasoning off.
  - Expansion hints now use the configured keybinding.
  - Agent guidance now prioritises acting on clear requests without unsolicited deferral.
  - Fixed transient Codex transport failures becoming non-retryable after recovery attempts.
  - Fixed duplicate voice task submissions from progress updates and repeated handoffs.
  - Voice task preparation now preserves captured speech, tone and instructions without adding questions or next steps.
  - Voice now recognises conversational wrap-ups and waits for LAN speaker playback before ending calls.
  - Fixed stalled short audio tails, playback bursts and duplicated LAN audio. Codex Live now uses Opus packet repair.
  - Added content-free connection and playback diagnostics without recording audio.
  - Fixed generated task text appearing as user speech.
  - LAN Stop now cancels pending task preparation. Herdr Disconnect also closes the listener.
  - Added host-side voice settings without starting Pi or a call.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-guardian — 0.0.1

- Initial release of Codex Guardian approval reviews for Pi.
  - Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
  - AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
  - Use `/guardian` to inspect status, enable or disable protection, and reload rules.

  Installed separately from the extension bundles. Review requests are not confirmed to be free.

[Full changelog](./packages/pi-codex-guardian/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.13

- Requires Pi 1.5 or newer.

  - Added `/imagegen` access selection and API model, quality and complexity preferences.
  - OpenAI API access now supports GIF and SVG generation and per-request output controls.
  - Tool discovery now shows controls for the selected access route and requires explicit image references for edits.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.10

- Added an extension API for Web Run search and navigation, using the existing provider and login without adding conversation messages.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.103

- Include bundled package updates:

  - @howaboua/pi-ask: Requires Pi 1.5 or newer. - Waiting prompts now report Pi's native blocked state. Steering prompts remain non-blocking. - Invalid question arguments now explain how to find the supported format. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - @howaboua/pi-gippity-control: Requires Pi 1.5 or newer. - Fixed duplicate voice task submissions from progress updates and repeated handoffs. - Voice task preparation now preserves captured speech, tone and instructions without adding questions or next steps. - Voice now recognises conversational wrap-ups and waits for LAN speaker playback before ending calls. - Fixed stalled short audio tails, playback bursts and duplicated LAN audio. Codex Live now uses Opus packet repair. - Added content-free connection and playback diagnostics without recording audio. - Fixed generated task text appearing as user speech. - LAN Stop now cancels pending task preparation. Herdr Disconnect also closes the listener. - Added host-side voice settings without starting Pi or a call. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - @howaboua/pi-grok-realtime: Requires Pi 1.5 or newer. - Added host-side voice settings without starting Pi or a call. - Herdr Disconnect now shuts down the LAN listener after stopping the call. - Reduced mid-word playback cutouts. Initial playback buffers about 500 ms plus one device callback, and quiet pauses can grow by up to 500 ms. - Recoverable audio-device underruns and overruns no longer end calls. - Added bounded playback and device-recovery diagnostics without recording audio. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - @howaboua/pi-shepherdr: Requires Pi 1.5 or newer. Update and restart controllers and workers together for shared Notes and boards. - `spawn` and `assign` now return after task submission by default. Set `blocking: true` to wait for the result. A profile's `blocking` setting still overrides `spawn`. - Agent references now use Pi session IDs across delegation, Notes and boards. Spawn returns one `agent` reference and sharing flags instead of separate context and board references. - Attached Notes reads keep alias paths and read-only warnings consistent across native, Code and Notebook results. - Rollover briefings now retain initial scope and the latest instruction without accumulating every message. Full messages remain in session history. - Fixed repeated writes of unchanged agent snapshots. - Closed workers no longer trigger a misleading notices-unavailable reconnect warning. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - @howaboua/pi-unicode-charts: Requires Pi 1.5 or newer. - Other extensions' later prompt sections now reach the model in interactive sessions. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.31

- Requires Pi 1.5 or newer.

  - Fixed duplicate voice task submissions from progress updates and repeated handoffs.
  - Voice task preparation now preserves captured speech, tone and instructions without adding questions or next steps.
  - Voice now recognises conversational wrap-ups and waits for LAN speaker playback before ending calls.
  - Fixed stalled short audio tails, playback bursts and duplicated LAN audio. Codex Live now uses Opus packet repair.
  - Added content-free connection and playback diagnostics without recording audio.
  - Fixed generated task text appearing as user speech.
  - LAN Stop now cancels pending task preparation. Herdr Disconnect also closes the listener.
  - Added host-side voice settings without starting Pi or a call.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-github-watch — 0.0.4

- - GPT mode uses note-style watch help.
  - Active watch results now state that updates arrive automatically without polling or a separate CLI watch.

[Full changelog](./packages/pi-github-watch/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.6

- Added `/terra` to switch to GPT-6.1 Terra with configurable context and reasoning defaults.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-grok-realtime — 0.0.5

- Requires Pi 1.5 or newer.

  - Added host-side voice settings without starting Pi or a call.
  - Herdr Disconnect now shuts down the LAN listener after stopping the call.
  - Reduced mid-word playback cutouts. Initial playback buffers about 500 ms plus one device callback, and quiet pauses can grow by up to 500 ms.
  - Recoverable audio-device underruns and overruns no longer end calls.
  - Added bounded playback and device-recovery diagnostics without recording audio.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-grok-realtime/CHANGELOG.md)

### @howaboua/pi-notes-compaction — 0.0.14

- Requires Pi 1.5 or newer.

  Older checkpoints may require a fresh note save before rollover.

  - Notes results in Pi's built-in codemode are now objects, matching Code and Notebook. Remove `JSON.parse` around those results.
  - Agent references now derive from Pi session IDs, with existing shared-note paths retained.
  - Fixed rollover rejecting successful large saves and saves in parallel tool groups. The saved-notes indicator uses the same readiness check.
  - Shared-note paths and read-only warnings now match across text and structured results.
  - History now defaults query-only requests to search and includes the first window's opening request.
  - History now ignores read-only hints on other actions.
  - Model-role guidance now identifies the current role and offers only configured roles for rollover.
  - Notes help now distinguishes virtual note paths from agent references and filesystem paths.
  - Added `address` and `body` aliases for note paths and write text.
  - Expansion hints now use the configured keybinding.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-notes-compaction/CHANGELOG.md)

### @howaboua/pi-observatory — 0.0.3

- Cache diagnostics now index with less disk-sync overhead.

[Full changelog](./packages/pi-observatory/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.7

- Added empty-call reaction discovery, including when no pet is connected, and deferred Code and Notebook help.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-sandbox — 0.1.4

- Fixed TypeScript calls rejecting action objects while equivalent JSON strings worked.
- Fixed concurrent first calls failing while the sandbox client was loading.

[Full changelog](./packages/pi-sandbox/CHANGELOG.md)

### @howaboua/pi-shepherdr — 0.2.26

- Requires Pi 1.5 or newer.

  Update and restart controllers and workers together for shared Notes and boards.

  - `spawn` and `assign` now return after task submission by default. Set `blocking: true` to wait for the result. A profile's `blocking` setting still overrides `spawn`.
  - Agent references now use Pi session IDs across delegation, Notes and boards. Spawn returns one `agent` reference and sharing flags instead of separate context and board references.
  - Attached Notes reads keep alias paths and read-only warnings consistent across native, Code and Notebook results.
  - Rollover briefings now retain initial scope and the latest instruction without accumulating every message. Full messages remain in session history.
  - Fixed repeated writes of unchanged agent snapshots.
  - Closed workers no longer trigger a misleading notices-unavailable reconnect warning.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

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

### @howaboua/pi-skill-harness-and-agent-engineering — 0.0.7

- Clarified help-backed tool design: ignore unused presentation hints without weakening validation of meaningful arguments.

[Full changelog](./packages/pi-skill-harness-and-agent-engineering/CHANGELOG.md)

### @howaboua/pi-skill-omarchy-help — 0.0.6

- Expanded Omarchy guidance for personalization, maintenance, recovery, Bluetooth, crashes, and runtime triage.

[Full changelog](./packages/pi-skill-omarchy-help/CHANGELOG.md)

### @howaboua/pi-skills — 0.0.26

- Include bundled package updates:

  - @howaboua/pi-skill-code: Removed the manual Codex PR review request template from repository-delivery guidance.

[Full changelog](./packages/pi-skills/CHANGELOG.md)

### @howaboua/pi-smart-btw — 0.2.8

- GPT-6 Sol and Luna now share Astra's Codex support.
  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.111

- Include bundled package updates:

  - @howaboua/pi-ask: Requires Pi 1.5 or newer. - Waiting prompts now report Pi's native blocked state. Steering prompts remain non-blocking. - Invalid question arguments now explain how to find the supported format. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - @howaboua/pi-gippity-control: Requires Pi 1.5 or newer. - Fixed duplicate voice task submissions from progress updates and repeated handoffs. - Voice task preparation now preserves captured speech, tone and instructions without adding questions or next steps. - Voice now recognises conversational wrap-ups and waits for LAN speaker playback before ending calls. - Fixed stalled short audio tails, playback bursts and duplicated LAN audio. Codex Live now uses Opus packet repair. - Added content-free connection and playback diagnostics without recording audio. - Fixed generated task text appearing as user speech. - LAN Stop now cancels pending task preparation. Herdr Disconnect also closes the listener. - Added host-side voice settings without starting Pi or a call. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - @howaboua/pi-grok-realtime: Requires Pi 1.5 or newer. - Added host-side voice settings without starting Pi or a call. - Herdr Disconnect now shuts down the LAN listener after stopping the call. - Reduced mid-word playback cutouts. Initial playback buffers about 500 ms plus one device callback, and quiet pauses can grow by up to 500 ms. - Recoverable audio-device underruns and overruns no longer end calls. - Added bounded playback and device-recovery diagnostics without recording audio. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - @howaboua/pi-shepherdr: Requires Pi 1.5 or newer. Update and restart controllers and workers together for shared Notes and boards. - `spawn` and `assign` now return after task submission by default. Set `blocking: true` to wait for the result. A profile's `blocking` setting still overrides `spawn`. - Agent references now use Pi session IDs across delegation, Notes and boards. Spawn returns one `agent` reference and sharing flags instead of separate context and board references. - Attached Notes reads keep alias paths and read-only warnings consistent across native, Code and Notebook results. - Rollover briefings now retain initial scope and the latest instruction without accumulating every message. Full messages remain in session history. - Fixed repeated writes of unchanged agent snapshots. - Closed workers no longer trigger a misleading notices-unavailable reconnect warning. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - @howaboua/pi-unicode-charts: Requires Pi 1.5 or newer. - Other extensions' later prompt sections now reach the model in interactive sessions. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.25

- Reviewer prompts now request evidence-backed findings without issue-count targets.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.9

- Expanded AGENTS.md notices now use the same muted theme colour as their summaries.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-suggestions — 0.0.2

- Added editable Markdown instructions in /suggestions, with defaults favouring productive next actions and avoiding repeated requests or completed work.

[Full changelog](./packages/pi-suggestions/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.4

- Requires Pi 1.5 or newer.

  - Other extensions' later prompt sections now reach the model in interactive sessions.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

