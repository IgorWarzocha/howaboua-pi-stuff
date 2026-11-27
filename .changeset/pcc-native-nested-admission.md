---
"@howaboua/pi-codex-conversion": patch
---

- Removed Structured mode. VM Code is now the default, and saved Structured settings (`normal`) migrate to VM Code.
- Added per-model Default, On and Off controls under `/codex` → General. Off restores Pi's tools and provider behaviour; Selected models scope uses a provider-and-model whitelist. Previously opted-in Responses providers seed compatible models on first activation in Automatic or All; existing model rules take precedence.
- Fixed nested Code and Notebook tool calls to respect Pi's tool selection, allowlists and guards. Existing sessions retain their selections; older sessions without recorded nested selections regain the default tools. An in-flight Pi tool call can delay an outer yield until it settles.
- Background shell completions now reach active agents after the current tool batch and wake idle sessions.
- Partial `apply_patch` failures now report changed paths and unfinished edits. Patch guidance recommends completing related patches before formatting changes their context.
- VM Code now identifies a missing closing brace in a one-off block and confirms that the cell did not run. Code and Notebook guidance encourages computation and tool orchestration with block-scoped temporary bindings.
