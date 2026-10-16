---
"@howaboua/pi-codex-conversion": patch
---

Code Mode always uses the pinned official OpenAI runtime. Local builds and `tools.customRustBinariesDir` no longer override it. Other native helper overrides are unchanged.

Updated the bundled patch helper to Codex 0.163, retaining line-ending preservation and structured partial-failure results.

Tightened notes guidance to favour concise milestone checkpoints over progress logs and repeated reads.
