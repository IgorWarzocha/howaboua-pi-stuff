---
"@howaboua/pi-auto-trees": patch
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-codex-web-run": patch
"@howaboua/pi-explore-subagents": patch
"@howaboua/pi-gpt-switcher": patch
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-smart-btw": patch
"@howaboua/pi-subagent-review": patch
---

GPT-6 Sol and Luna now share Astra's Codex support.

- Removed `/terra`; use `/luna` instead.
- Added Responses Lite, non-destructive reasoning changes and terse context guidance for GPT-6 Sol and Luna.
- Agent, review, exploration, web search, voice summary and image-description defaults now use GPT-6; Luna replaces Terra defaults. GPT Switcher retains Luna's 472K context limit, while Codex Conversion defaults all three GPT-6 models to 272K.
