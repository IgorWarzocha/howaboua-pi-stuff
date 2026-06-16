---
"@howaboua/pi-codex-conversion": minor
---

Add Codex reset-credit count and Ctrl+R reset action in the Usage tab.

Theme the Codex adapter status label with Pi's active accent color and dim the status details.

Show collapsed shell output previews and capped patch diffs, including PATH-mode `apply_patch` previews and native-style PATH tool call labels inside `exec_command`.

Preserve raw shell behavior for PATH tool pipelines/redirections and use the active `exec_command` workdir for PATH `apply_patch` previews.

Keep segmented PATH `apply_patch` rendering after failures while showing the actual shell error output instead of an optimistic diff preview.

Surface captured `exec_bridge` startup stderr in `exec_command` failures.

Document building bundled Codex tools from a Git checkout for older Linux compatibility.

Update Pi development dependencies to 0.79.4, match Pi's Codex SSE timeout, and stop shrinking Codex model context windows.
