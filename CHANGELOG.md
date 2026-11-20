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

### @howaboua/pi-agent-board — 0.0.9

- Shorter board guidance clarifies how to copy a full thread ID and recover from closed threads.
- Accepts `reply` as an alias for posting to a thread.

[Full changelog](./packages/pi-agent-board/CHANGELOG.md)

### @howaboua/pi-agent-comms — 0.0.4

- Context rollover keeps the explicitly selected role instead of inferring it from the model or reasoning level. A temporary reasoning boost expiring no longer blocks role switches.
- `/roles` shows role names and descriptions first in a read-only Pi list.
- Agents use configured role descriptions to decide whether a substantial new phase calls for a switch.
- Notes guidance clarifies what to checkpoint before rollover and reminds continuing agents to recover their notes and resume unfinished work.
- Notes reads, lists and searches reuse the same loaded notes.
- Fixed shared Notes reads and lists failing for a remote-backed parent session.
- History reads do less work per page, and ranked searches reuse unchanged search scopes.
- Shorter board guidance clarifies how to copy a full thread ID and recover from closed threads.
- Board accepts `reply` as an alias for posting to a thread.

[Full changelog](./packages/pi-agent-comms/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.21

- Shorter review and planning prompts clarify when to ask, wait for a handoff or stop.

[Full changelog](./packages/pi-ask/CHANGELOG.md)

### @howaboua/pi-better-skills-tool — 0.0.14

- Fixed Skills discovery failing on an empty object in Code and Notebook.
- Skills discovery and reads no longer open unrelated skill files when Pi has already loaded the catalog.
- Shorter Skills help explains how to combine body and reference reads.

[Full changelog](./packages/pi-better-skills-tool/CHANGELOG.md)

### @howaboua/pi-browser — 0.0.14

- Updates use Pi's native changelog notices and `collapseChangelog` instead of custom suppression.
- Reading a page from a large browser result no longer rereads the whole result.
- Browser help clarifies when to ask before proceeding and how to keep references on the right host.

[Full changelog](./packages/pi-browser/CHANGELOG.md)

### @howaboua/pi-cache-hit-predictor — 0.0.1

### Changes

- [#140](https://github.com/IgorWarzocha/howaboua-pi-stuff/pull/140) [`c95d68a`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/c95d68a21939860e4c6dcff9c58a6bf8a50044ff) Thanks [@IgorWarzocha](https://github.com/IgorWarzocha)!:
  - Show inline cache-hit predictions when switching models or reasoning lanes.
  - Warn once that automatic reasoning changes can miss the prompt cache and affect costs or quotas.

[Full changelog](./packages/pi-cache-hit-predictor/CHANGELOG.md)

### @howaboua/pi-chatgpt-sites — 0.0.5

- Shorter Sites guides distinguish production authorisation, access checks and recovery after a partial publication.

[Full changelog](./packages/pi-chatgpt-sites/CHANGELOG.md)

### @howaboua/pi-codex-conversion — 5.0.2

- Added GPT Live 1.1 voice with an OpenAI API key. Codex login remains the default.
- Active voice calls carry their summary and spoken conversation across compaction and Notes rollovers. Refresh waits for playback to finish, or keeps the current call open if playback does not settle.
- Codex Responses Lite preserves more screenshot detail, up to Codex's 6,000-pixel and 10,000-patch limits.
- Reduced memory use when preparing image-heavy Codex requests and continuing WebSocket sessions.
- Codex honours `Retry-After` in streamed errors and `Retry-After-Ms` in HTTP and streamed errors.
- Codex omits reasoning effort when the model declares the requested level unsupported.
- Auto Reasoning guidance maps effort levels to the work ahead and recommends changing effort by work phase rather than by tool call.
- QuickJS Code uses Pi's bundled runtime instead of downloading another copy.
- VM Code reports the actual syntax error in malformed cells with top-level `await`. Its guidance explains how to scope temporary variables to avoid redeclaration errors.
- TS mode accepts empty-object help calls, matching other Code and Notebook modes.
- Code and Notebook guidance covers in-cell data processing, binding reuse, patch syntax, rollback limits and restorable hook dependencies. Image and binding errors explain how to recover.
- Code and Notebook no longer save a second copy of images already included in the tool result. Expanded cells omit text already shown in a nested tool trace.
- Notes checkpoints no longer repeat an unchanged tool list.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-guardian — 0.0.1

- Initial release of Codex Guardian approval reviews for Pi.
  - Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
  - AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
  - Use `/guardian` to inspect status, enable or disable protection, and reload rules.

  Installed separately from the extension bundles. Review requests are not confirmed to be free.

[Full changelog](./packages/pi-codex-guardian/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.16

- Displaying generated images inline no longer rereads the saved files.
- Image help shows the current access mode's arguments once, including how to select an edit target.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.12

- Web tool guidance distinguishes navigation references from Markdown citations. Code and Notebook usage shows URL navigation and the optional search context size.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.109

**Bundle removals**

- Grok Realtime and Pet are no longer bundled. Install either separately with `pi install npm:@howaboua/pi-grok-realtime` or `pi install npm:@howaboua/pi-pet`.
- Removed the retired Auto Trees, Smart BTW and Subagent Review extensions.

**Bundled updates**

- GipPity Control adds optional GPT Live 1.1 voice with an OpenAI API key.
- GitHub Watch shows known review-bot quota notices without waking the agent.
- Better Skills Tool fixes empty-object discovery and avoids opening unrelated skill files.
- Shepherdr fixes stale attachments blocking unrelated Notes and History lookups.
- Suggestions skips history scans when disabled and scans once per request when enabled.
- Ask and Unicode Charts have shorter agent guidance.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.33

- Added GPT Live 1.1 voice with an OpenAI API key. Codex login remains the default.
- Streamlined voice routing, progress and task preparation instructions. Existing custom voice prompts are preserved.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-github-watch — 0.0.8

- Known Codex, Cursor Bugbot and CodeRabbit quota notices appear in the UI without waking the agent.
- Shorter watch help clarifies target references, when watches stop and how to resume a paused watch.

[Full changelog](./packages/pi-github-watch/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.7

- Requires Pi 1.5 or newer.

  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

  - `/sol` and `/astra` now select GPT-6.2 Sol and Astra, including without Codex Conversion.
  - Context defaults are now 500K for Sol, Terra and Luna, and 256K for Astra. Existing preferences are preserved.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-grok-realtime — 0.0.7

- Streamlined voice instructions for delegating work, handling pauses and ending calls.

[Full changelog](./packages/pi-grok-realtime/CHANGELOG.md)

### @howaboua/pi-notes-compaction — 0.0.19

- Context rollover keeps the explicitly selected role instead of inferring it from the model or reasoning level. A temporary reasoning boost expiring no longer blocks role switches.
- `/roles` shows role names and descriptions first in a read-only Pi list.
- Agents use configured role descriptions to decide whether a substantial new phase calls for a switch.
- Notes guidance clarifies what to checkpoint before rollover and reminds continuing agents to recover their notes and resume unfinished work.
- Notes reads, lists and searches reuse the same loaded notes.
- Fixed shared Notes reads and lists failing for a remote-backed parent session.
- History reads do less work per page, and ranked searches reuse unchanged search scopes.

[Full changelog](./packages/pi-notes-compaction/CHANGELOG.md)

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

### @howaboua/pi-shepherdr — 1.0.3

- Shortened delegation guidance without repeating the task in the worker's instructions.
- Clarified agent tool help for replies, sharing and closing sessions.
- Fixed outdated attachments blocking notes and history lookups for unrelated agents.

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

### @howaboua/pi-stuff — 0.0.117

**Bundle removals**

- Grok Realtime and Pet are no longer bundled. Install either separately with `pi install npm:@howaboua/pi-grok-realtime` or `pi install npm:@howaboua/pi-pet`.
- Removed the retired Auto Trees, Smart BTW and Subagent Review extensions.

**Bundled updates**

- GipPity Control adds optional GPT Live 1.1 voice with an OpenAI API key.
- GitHub Watch shows known review-bot quota notices without waking the agent.
- Better Skills Tool fixes empty-object discovery and avoids opening unrelated skill files.
- Shepherdr fixes stale attachments blocking unrelated Notes and History lookups.
- Suggestions skips history scans when disabled and scans once per request when enabled.
- Ask and Unicode Charts have shorter agent guidance.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.10

- Updates use Pi's native changelog notices and `collapseChangelog` instead of custom suppression.
- Nested AGENTS.md guidance is saved once per delivery without duplicating its text in session metadata.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-suggestions — 0.0.4

- Disabled suggestions no longer scan conversation history. Enabled suggestions scan it once per request.
- Suggestion requests no longer repeat the draft instruction on every turn.

[Full changelog](./packages/pi-suggestions/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.5

- Shortened chart-format guidance in both prompt modes.

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

