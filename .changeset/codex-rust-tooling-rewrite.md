---
"@howaboua/pi-codex-conversion": patch
---

Rework Codex conversion around Rust-owned tool execution: route apply_patch, view_image, imagegen, web_run, exec_command, and write_stdin through bundled Rust binaries, reorganize tools into tool-owned folders with colocated Rust source and binaries, add cross-platform binary build artifacts, refresh PATH-mode prompt/tool behavior, and update Codex settings with grouped tabs and tool-rendering controls.
