# @howaboua/pi-codex-imagegen

## 0.0.2

- Fix worker settlement, custom model preservation, and prompt-only image generation.

  - Settle Shepherdr workers after Pi expands skill or prompt-template invocations.
  - Preserve custom Codex models and `models.json` overrides, including after refresh.
  - Keep optional tool arguments optional in Codex Responses requests while preserving explicit strict sampling.
  - Treat null image selectors as absent, so prompt-only requests generate rather than edit.
  - Honor the details toggle in Notebook Mode to hide duplicate output previews.
  - Show submitted messages without waiting for cached WebSocket warmup, while keeping generation serialized behind it.

## 0.0.1

- Initial release of Imagegen for Codex image generation and editing in normal Pi, Code Mode, and Notebook Mode.

  - Generate new images or edit recent and workspace-local PNG, JPEG, GIF, or WebP files.
  - Save outputs beneath the workspace and use stock, renamed, or proxied Codex providers.
