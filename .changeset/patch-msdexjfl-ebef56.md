---
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-gippity-control": patch
---

Seed realtime voice with a user-selected session context model and reasoning level, default context reasoning to high, summarize clean conversational text without reasoning or tool noise, show the exact startup summary in a display-only Voice Context entry, preserve native Responses checkpoints without sharing the main cache lane, give Pi non-triggering model-visible lifecycle guidance for spoken delegation progress and restore normal interaction on exit, regenerate context after an explicit voice restart while preserving sessions across device handoff, retain stopped-session transcript tails for fresh restarts, keep muted calls alive with silence RTP, show each finalized spoken user turn once without exposing partial recognition, route hidden clean delegation envelopes with deduplicated finalized frontend history, map clean Pi assistant messages to realtime commentary or speech at message boundaries, display completed voice replies once, and request delegation acknowledgement fillers explicitly.

Guide Code Mode to reread files changed since their last read before patching them again.

Avoid duplicating partial apply patch failures in Code Mode traces and result metadata.

Guide generated commands to follow the detected shell's syntax, quoting, and variable rules.

Tell agents to resume running exec cells and command sessions near expected completion instead of short polling.

Resolve bare Bash requests through Pi's detected shell on Windows and prevent persisted terminal controls from reaching custom exec renderers.

Identify the user-owned realtime system prompt by its default path in the migration changelog.

Remove the redundant dimmed voice-context summary from both settings screens.
