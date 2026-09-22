# @howaboua/pi-codex-web-run

## 0.0.4

- GPT-6 Sol and Luna now share Astra's Codex support.

  - Removed `/terra`; use `/luna` instead.
  - Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
  - Image descriptions now use GPT-6 Luna directly instead of preferring older mini models.
  - Cost estimates now use published GPT-6 Sol and Luna rates, including cache writes and long-context pricing.
  - Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.

## 0.0.3

- Remove retired Spark from Codex tool authentication preferences. Codex Conversion now explains biological-policy errors when the server omits an explanation.

## 0.0.2

- Fixed Codex web search and image generation to use local Codex authentication on unrelated chat providers while preserving explicit Codex routes and optional Pi Codex integration. Removed Pi Codex package dependencies.

## 0.0.1

- Initial release of Web Run for Codex web search and page navigation in normal Pi, Code Mode, and Notebook Mode.

  - Search the web or images, open results, follow links, and find text while retaining reusable source references.
  - Use stock, renamed, or proxied Codex providers through a small JSON route file.
