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

### @howaboua/pi-agent-board — 0.0.6

- Requires Node.js 22.19 or newer.
  - Board now defers its engine while disabled, without losing saved membership or history.
  - Board notifications now use compact previews with author and post/thread references.
  - Board now uses minute precision in displayed dates, preserving existing archives and post ordering.
  - Board guidance now uses shared references only when recipients have access.
  - Replaced the TypeBox dependency with Pi's native schema validation.

[Full changelog](./packages/pi-agent-board/CHANGELOG.md)

### @howaboua/pi-agent-comms — 0.0.1

- Requires Node.js 22.19 or newer.
  - Initial release combining session notes, searchable history, context rollover and agent boards. Agent Comms is an alternative to the maintained standalone Notes Compaction and Agent Board packages, preserving existing data and settings. Do not load both alternatives together.
  - Notes and Board work independently and initialise on demand. Each has an Off setting.
  - Notes reads accept `end_line` as an alias for `stop_line`.
  - `/notes` and `/board` open their settings tabs. The Board tab opens the discussion viewer.
  - Added context recovery from saved checkpoints and selected past user messages, with current instructions taking precedence.
  - Shared Notes and Board references account for recipient access, with self-contained replies when access is unavailable or unknown.

[Full changelog](./packages/pi-agent-comms/CHANGELOG.md)

### @howaboua/pi-ask — 0.0.19

- Requires Node.js 22.19 or newer.
  - Replaced the TypeBox dependency with Pi's native schema builders and validation.

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

### @howaboua/pi-codex-conversion — 4.0.10

- Code, Notebook, TS and JS Notebook now provide `content()` to emit mixed MCP text and images in order.
- Code and Notebook now keep unchanged nested-tool images stable across progress updates.
- Code and Notebook guidance now follows the available nested tools instead of recommending absent shell or patch bindings.
- General guidance now asks for direct, supported conclusions, with caveats only when they change the answer or next action.
- Uncollected background shell completions now wake idle agents without interrupting active work.
- Compaction and rollover now restore a background-shell inventory in late runtime context without changing the standing prompt.
- Patch success results omit routine counters. Errors retain partial-change details and recovery instructions.
- Unavailable image viewing and reasoning adjustment now report recovery options.
- Voice task acknowledgements now omit unused task IDs.
- Reduced temporary memory use when checking Codex conversation continuity and preparing WebSocket requests.
- Codex now stops retrying recognised content-policy, inference-hook, access-program and workspace rejections while preserving transient-error retries.
- JS Notebook now uses the Pi codemode 1.5.2 runtime.
- Tool schemas and input validation now use Pi's native schema package without a TypeBox dependency.
- TS notebooks now use tsrs 0.23, including upstream fixes for memory growth during repeated compiler rebuilds.
- Code now uses the official 0.167 host runtime.
- Bundled native tools and voice helpers now use refreshed Rust dependencies.
- Responses Lite proxies now honour `compat.promptCacheKeyMode: "disabled"`.
- Notebook, compaction metadata and usage reset dates now use minute precision.

[Full changelog](./packages/pi-codex-conversion/CHANGELOG.md)

### @howaboua/pi-codex-guardian — 0.0.1

- Initial release of Codex Guardian approval reviews for Pi.
  - Select exact tools and optional argument regexes for AI review or local blocking in native Pi, Code Mode and Notebook Mode. Global and trusted project rules combine. No rules are configured by default.
  - AI reviews use the active ChatGPT-backed Codex session. Denials and review failures block execution. Local blocking needs no model request.
  - Use `/guardian` to inspect status, enable or disable protection, and reload rules.

  Installed separately from the extension bundles. Review requests are not confirmed to be free.

[Full changelog](./packages/pi-codex-guardian/CHANGELOG.md)

### @howaboua/pi-codex-imagegen — 0.0.14

- Replaced the TypeBox dependency with Pi's native schema builders and validation.

[Full changelog](./packages/pi-codex-imagegen/CHANGELOG.md)

### @howaboua/pi-codex-web-run — 0.0.10

- Added an extension API for Web Run search and navigation, using the existing provider and login without adding conversation messages.

[Full changelog](./packages/pi-codex-web-run/CHANGELOG.md)

### @howaboua/pi-extensions — 0.0.106

- Include bundled package updates:

  - @howaboua/pi-ask: Requires Node.js 22.19 or newer. - Replaced the TypeBox dependency with Pi's native schema builders and validation.
  - @howaboua/pi-gippity-control: - Voice task acknowledgements now omit unused task IDs. - Bundled voice helpers now use refreshed Rust dependencies. - Local voice tools now use Pi's native schema types instead of TypeBox.
  - @howaboua/pi-github-watch: Requires Pi 1.5 or newer. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`. - Feedback notices now frame replies and review resolution around the current task rather than prescribing a response. - Watch schedules now display check times to the minute. - Removed the TypeBox installation requirement.
  - @howaboua/pi-grok-realtime: - Voice task acknowledgements now omit unused task IDs. - Voice context timestamps now use minute precision. - Bundled audio helpers now use refreshed Rust dependencies. - Local voice tools now use Pi's native schema types instead of TypeBox.
  - @howaboua/pi-pet: Requires Pi 1.5 or newer and Node.js 22.19 or newer. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`. - Pet-authoring metadata now records UTC timestamps to the minute. - Removed the TypeBox installation requirement.
  - @howaboua/pi-shepherdr: Removed the legacy Herdr backend and SSH bridge. Requires Herdr Core 0.1.18+, Pi 1.5+ and Node.js 22.19+. Legacy Herdr TUI is unsupported. Its last supported release, Shepherdr 0.2.27, is unmaintained, with [source available for forks](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/5ede06bdc32da2b513f0709966af1f32908f243c/packages/pi-shepherdr). Update and restart controllers and workers together. Start fresh Core terminals for older Herdr sessions and reselect watches when changing Core namespaces. Replace pane placement with terminal, new-tab or new-workspace placement. - Shepherdr now runs without other extensions. Optional sharing supports Agent Comms or standalone Notes Compaction and Agent Board, preserving saved notes and boards. - Agent calls now accept current Core machine names or stable IDs. Saved routes and watches survive renames. Connections adds machines through `hc machine add`. - Remote supervision and sharing now use persistent Core attachments. Saved checkpoints remain readable after workers and intermediate controllers close, including older sessions across connected machines. - Concurrent Pi sessions now share machine-local launch and saved-session read limits, with calls remaining pending until their normal result is available. - Ordinary workers now end with their parent's program. Active remote connections enforce cross-machine cleanup. Detached workers remain independent. - Added a public worker API with saved-session reuse and caller-selected detached lifetime. - `/root` now follows saved spawn ancestry independently of sharing. Older workers without saved ancestry must use exact session references. - Sending or assigning work to a closed, owned worker now resumes its saved Pi session before delivery. - The widget now shows watched peers without repeating supervised workers. Monitoring warnings remain visible. Shells retaining old Pi labels no longer appear as live agents. - Fixed completed replies being hidden by empty notice turns, and closed agents causing collection warnings or settlement retries. - Agent replies now return when the extension accepts the answer instead of blocking later questions until resumed work finishes. - Attachment and detachment now accept context or Board sharing independently. Incoming messages identify sender access, distinguishing machine IDs from Pi agent references. - Monitoring notices now describe delayed or unavailable agent updates and automatic retry without duplicate internal errors during Core restarts. - Agent help now asks callers to trust worker judgement instead of over-prescribing restrictions or narrowing the task unnecessarily. - Worker profiles now brief only the initial assignment instead of pinning restrictions in the standing prompt. Later assignments and model-role changes can reuse the same agent and its notes. - Agent help now keeps each agent available until its task is verified complete, with corrections returned to the same agent before closing it. - Agent help now directs callers to skip acknowledgements, status-only updates and standby reminders that needlessly wake idle agents. - Removed the TypeBox installation requirement.
  - @howaboua/pi-subagent-review: Requires Pi 1.5 or newer. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`. - Conversation summaries now use minute-precision timestamps.

[Full changelog](./packages/pi-extensions/CHANGELOG.md)

### @howaboua/pi-gippity-control — 0.0.32

- Voice task acknowledgements now omit unused task IDs.
- Bundled voice helpers now use refreshed Rust dependencies.
- Local voice tools now use Pi's native schema types instead of TypeBox.

[Full changelog](./packages/pi-gippity-control/CHANGELOG.md)

### @howaboua/pi-github-watch — 0.0.5

- Requires Pi 1.5 or newer.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Feedback notices now frame replies and review resolution around the current task rather than prescribing a response.
  - Watch schedules now display check times to the minute.
  - Removed the TypeBox installation requirement.

[Full changelog](./packages/pi-github-watch/CHANGELOG.md)

### @howaboua/pi-gpt-switcher — 0.1.6

- Added `/terra` to switch to GPT-6.1 Terra with configurable context and reasoning defaults.

[Full changelog](./packages/pi-gpt-switcher/CHANGELOG.md)

### @howaboua/pi-grok-realtime — 0.0.6

- Voice task acknowledgements now omit unused task IDs.
- Voice context timestamps now use minute precision.
- Bundled audio helpers now use refreshed Rust dependencies.
- Local voice tools now use Pi's native schema types instead of TypeBox.

[Full changelog](./packages/pi-grok-realtime/CHANGELOG.md)

### @howaboua/pi-notes-compaction — 0.0.16

- Requires Node.js 22.19 or newer.
  - Notes now offers Off and defers inactive initialisation without deleting saved data or retired context boundaries.
  - Notes now accepts `content` as a body alias for `text` in typed tool calls.
  - Notes reads now accept `end_line` as an alias for `stop_line`.
  - Notes results now omit routine bookkeeping while retaining paths, content, search matches and truncation.
  - Context recovery now checks selected past user messages for intent and communication preferences, with current instructions taking precedence.
  - Context window openings now omit UUIDs; history still exposes window references.
  - Notes guidance now consolidates changed checkpoints near the end of substantive turns.
  - Shared notes and history now report recovery options when saved context cannot be accessed.
  - History searches no longer retain full rendered copies of tool arguments and messages for the session lifetime.
  - Notes now uses minute precision in displayed dates, preserving existing records.
  - Replaced the TypeBox dependency with Pi's native schema validation.

[Full changelog](./packages/pi-notes-compaction/CHANGELOG.md)

### @howaboua/pi-observatory — 0.0.4

- Requires Pi 1.5 or newer.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Display and informational status dates now use minute precision.

[Full changelog](./packages/pi-observatory/CHANGELOG.md)

### @howaboua/pi-pet — 0.1.8

- Requires Pi 1.5 or newer and Node.js 22.19 or newer.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Pet-authoring metadata now records UTC timestamps to the minute.
  - Removed the TypeBox installation requirement.

[Full changelog](./packages/pi-pet/CHANGELOG.md)

### @howaboua/pi-sandbox — 0.1.6

- Fixed short sandbox commands occasionally reporting a startup failure.
- Sandbox creation dates now use minute precision.
- Removed the TypeBox installation requirement.

[Full changelog](./packages/pi-sandbox/CHANGELOG.md)

### @howaboua/pi-shepherdr — 1.0.0

### Breaking changes

- Removed the legacy Herdr backend and SSH bridge. Requires Herdr Core 0.1.18+, Pi 1.5+ and Node.js 22.19+. Legacy Herdr TUI is unsupported. Its last supported release, Shepherdr 0.2.27, is unmaintained, with [source available for forks](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/5ede06bdc32da2b513f0709966af1f32908f243c/packages/pi-shepherdr). Update and restart controllers and workers together. Start fresh Core terminals for older Herdr sessions and reselect watches when changing Core namespaces. Replace pane placement with terminal, new-tab or new-workspace placement.
  - Shepherdr now runs without other extensions. Optional sharing supports Agent Comms or standalone Notes Compaction and Agent Board, preserving saved notes and boards.
  - Agent calls now accept current Core machine names or stable IDs. Saved routes and watches survive renames. Connections adds machines through `hc machine add`.
  - Remote supervision and sharing now use persistent Core attachments. Saved checkpoints remain readable after workers and intermediate controllers close, including older sessions across connected machines.
  - Concurrent Pi sessions now share machine-local launch and saved-session read limits, with calls remaining pending until their normal result is available.
  - Ordinary workers now end with their parent's program. Active remote connections enforce cross-machine cleanup. Detached workers remain independent.
  - Added a public worker API with saved-session reuse and caller-selected detached lifetime.
  - `/root` now follows saved spawn ancestry independently of sharing. Older workers without saved ancestry must use exact session references.
  - Sending or assigning work to a closed, owned worker now resumes its saved Pi session before delivery.
  - The widget now shows watched peers without repeating supervised workers. Monitoring warnings remain visible. Shells retaining old Pi labels no longer appear as live agents.
  - Fixed completed replies being hidden by empty notice turns, and closed agents causing collection warnings or settlement retries.
  - Agent replies now return when the extension accepts the answer instead of blocking later questions until resumed work finishes.
  - Attachment and detachment now accept context or Board sharing independently. Incoming messages identify sender access, distinguishing machine IDs from Pi agent references.
  - Monitoring notices now describe delayed or unavailable agent updates and automatic retry without duplicate internal errors during Core restarts.
  - Agent help now asks callers to trust worker judgement instead of over-prescribing restrictions or narrowing the task unnecessarily.
  - Worker profiles now brief only the initial assignment instead of pinning restrictions in the standing prompt. Later assignments and model-role changes can reuse the same agent and its notes.
  - Agent help now keeps each agent available until its task is verified complete, with corrections returned to the same agent before closing it.
  - Agent help now directs callers to skip acknowledgements, status-only updates and standby reminders that needlessly wake idle agents.
  - Removed the TypeBox installation requirement.

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

### @howaboua/pi-smart-btw — 0.2.8

- GPT-6 Sol and Luna now share Astra's Codex support.
  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

[Full changelog](./packages/pi-smart-btw/CHANGELOG.md)

### @howaboua/pi-stuff — 0.0.114

- Include bundled package updates:

  - @howaboua/pi-ask: Requires Node.js 22.19 or newer. - Replaced the TypeBox dependency with Pi's native schema builders and validation.
  - @howaboua/pi-gippity-control: - Voice task acknowledgements now omit unused task IDs. - Bundled voice helpers now use refreshed Rust dependencies. - Local voice tools now use Pi's native schema types instead of TypeBox.
  - @howaboua/pi-github-watch: Requires Pi 1.5 or newer. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`. - Feedback notices now frame replies and review resolution around the current task rather than prescribing a response. - Watch schedules now display check times to the minute. - Removed the TypeBox installation requirement.
  - @howaboua/pi-grok-realtime: - Voice task acknowledgements now omit unused task IDs. - Voice context timestamps now use minute precision. - Bundled audio helpers now use refreshed Rust dependencies. - Local voice tools now use Pi's native schema types instead of TypeBox.
  - @howaboua/pi-pet: Requires Pi 1.5 or newer and Node.js 22.19 or newer. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`. - Pet-authoring metadata now records UTC timestamps to the minute. - Removed the TypeBox installation requirement.
  - @howaboua/pi-shepherdr: Removed the legacy Herdr backend and SSH bridge. Requires Herdr Core 0.1.18+, Pi 1.5+ and Node.js 22.19+. Legacy Herdr TUI is unsupported. Its last supported release, Shepherdr 0.2.27, is unmaintained, with [source available for forks](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/5ede06bdc32da2b513f0709966af1f32908f243c/packages/pi-shepherdr). Update and restart controllers and workers together. Start fresh Core terminals for older Herdr sessions and reselect watches when changing Core namespaces. Replace pane placement with terminal, new-tab or new-workspace placement. - Shepherdr now runs without other extensions. Optional sharing supports Agent Comms or standalone Notes Compaction and Agent Board, preserving saved notes and boards. - Agent calls now accept current Core machine names or stable IDs. Saved routes and watches survive renames. Connections adds machines through `hc machine add`. - Remote supervision and sharing now use persistent Core attachments. Saved checkpoints remain readable after workers and intermediate controllers close, including older sessions across connected machines. - Concurrent Pi sessions now share machine-local launch and saved-session read limits, with calls remaining pending until their normal result is available. - Ordinary workers now end with their parent's program. Active remote connections enforce cross-machine cleanup. Detached workers remain independent. - Added a public worker API with saved-session reuse and caller-selected detached lifetime. - `/root` now follows saved spawn ancestry independently of sharing. Older workers without saved ancestry must use exact session references. - Sending or assigning work to a closed, owned worker now resumes its saved Pi session before delivery. - The widget now shows watched peers without repeating supervised workers. Monitoring warnings remain visible. Shells retaining old Pi labels no longer appear as live agents. - Fixed completed replies being hidden by empty notice turns, and closed agents causing collection warnings or settlement retries. - Agent replies now return when the extension accepts the answer instead of blocking later questions until resumed work finishes. - Attachment and detachment now accept context or Board sharing independently. Incoming messages identify sender access, distinguishing machine IDs from Pi agent references. - Monitoring notices now describe delayed or unavailable agent updates and automatic retry without duplicate internal errors during Core restarts. - Agent help now asks callers to trust worker judgement instead of over-prescribing restrictions or narrowing the task unnecessarily. - Worker profiles now brief only the initial assignment instead of pinning restrictions in the standing prompt. Later assignments and model-role changes can reuse the same agent and its notes. - Agent help now keeps each agent available until its task is verified complete, with corrections returned to the same agent before closing it. - Agent help now directs callers to skip acknowledgements, status-only updates and standby reminders that needlessly wake idle agents. - Removed the TypeBox installation requirement.
  - @howaboua/pi-subagent-review: Requires Pi 1.5 or newer. - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`. - Conversation summaries now use minute-precision timestamps.
  - @howaboua/pi-skill-harness-and-agent-engineering: Pi extension guidance now recommends native schema builders and validation.

[Full changelog](./packages/pi-stuff/CHANGELOG.md)

### @howaboua/pi-subagent-review — 0.2.26

- Requires Pi 1.5 or newer.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Conversation summaries now use minute-precision timestamps.

[Full changelog](./packages/pi-subagent-review/CHANGELOG.md)

### @howaboua/pi-subdir-agents — 0.0.9

- Expanded AGENTS.md notices now use the same muted theme colour as their summaries.

[Full changelog](./packages/pi-subdir-agents/CHANGELOG.md)

### @howaboua/pi-suggestions — 0.0.3

- Requires Pi 1.5 or newer.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.
  - Fixed ghost suggestions in empty editors with decorated prompt prefixes, including `pi-powerline-footer`.
  - Added an off-by-default chat model fallback for unavailable or failed suggestion models.

[Full changelog](./packages/pi-suggestions/CHANGELOG.md)

### @howaboua/pi-unicode-charts — 0.1.4

- Requires Pi 1.5 or newer.
  - Other extensions' later prompt sections now reach the model in interactive sessions.
  - Removed custom changelog suppression. Updates use Pi's native notices and `collapseChangelog`.

[Full changelog](./packages/pi-unicode-charts/CHANGELOG.md)

