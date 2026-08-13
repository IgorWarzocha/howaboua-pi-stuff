---
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-ask": patch
"@howaboua/pi-auto-trees": patch
"@howaboua/pi-gippity-control": patch
"@howaboua/pi-shepherdr": patch
"@howaboua/pi-subagent-review": patch
---

Expose a reusable realtime voice prompt API, report open ask prompts, Auto Trees navigation, Shepherdr worker settlements, and isolated review progress through it, announce completed context compaction, begin speaking Pi updates after two sentences and continue by paragraph, use compatible reasoning summaries only for otherwise silent tool steps without exposing Chat Completions thinking content, make spoken delegation acknowledgements configurable, display and deliver V3 delegations as soon as they are created, preserve delegations that arrive after an acknowledgement completes, resume established calls when the realtime data channel closes, keep spoken Pi updates conversational instead of repeating them line by line, preserve the prepared Code Mode prompt and single prewarm for voice-started Pi turns, preserve Codex cache continuity across voice delegation and compaction prewarming, and reduce LAN playback dropouts with one additional jitter-buffer frame.
