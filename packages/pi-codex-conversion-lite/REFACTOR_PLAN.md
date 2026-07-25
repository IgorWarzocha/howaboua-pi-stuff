# Lite refactor plan

## Goal

Make the package the clean Codex adapter for both audiences:

- **Normal:** flat JSON-schema tools over standard Responses, including pre-5.6 models.
- **Code Mode:** `exec`/`wait` over Responses Lite for supported GPT-5.6 models.

Voice remains part of the native Codex experience. Public PATH mode does not.

## Decisions

- Resolve model, provider, tool surface, prompt, transport, and compaction policy once as an explicit runtime plan.
- Remove PATH mode, root command wrappers, shell interception, PATH prompts/UI/docs, and their tests.
- Retain native binaries and direct runners used by structured and nested tools; move them out of `tools/path` into honest owners.
- Read the existing `pi-codex-conversion.json`. Tolerate old fields and treat legacy `mode: "path"` as normal so package replacement needs no manual config reset.
- Preserve Code Mode host, protocol, nested-tool, provider-overlay, compaction, and voice boundaries.
- Keep `/codex` as one lazily loaded settings surface; arguments route to owned tabs rather than mutating settings through shortcut aliases.
- Fix dictation failed-start cleanup.
- Do not add stream bounds, queue limits, exec-session eviction, or tests for those deferred product choices.

## Work

- [x] Add runtime-plan and old-config compatibility coverage.
- [x] Delete public PATH mode and shell-command magic.
- [x] Rehome retained native execution/output/rendering code.
- [x] Replace distributed activation predicates with the runtime plan.
- [x] Split config schema, migration, storage, and request policy; remove the import cycle.
- [x] Make dictation startup failure close resources and enter a terminal state.
- [x] Rewrite package docs and release history for lite.
- [x] Add lite build/pack/native release gates and the final changeset.
- [x] Run package check, build, dry pack, and final architecture review.

## Done when

Normal and Code Mode each have one traceable route from model selection to tool execution; no public or prompt-visible PATH behavior remains; existing users keep their config; voice and native Codex behavior remain intact; the package is independently releasable.
