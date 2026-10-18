---
"@howaboua/pi-shepherdr": patch
---

**Worker integrations**

- Fresh workers now share their parent's cache routing with compatible Codex Conversion. Shared notes remain optional, and native sessions and histories remain separate.
- Fresh workers inherit the live Board setting before their first request, keeping Board tools and guidance available from startup.
- Added an optional Pulses runner with persistent workers, saved-session reuse and completion reports that wake the parent.

**Agent tools and guidance**

- Expanded tool calls now show outgoing tasks, messages, replies and focus handoffs in full.
- Added compact agent help and hosted Board briefings for PCC GPT prompt mode.
- Agent discovery now uses the same help contract across native, Code and Notebook tools.
- Added delegation guidance for distinct scopes, shared project context and combined validation.
- Invalid spawn names now explain naming limits and how to use a longer label. Spawn guidance favours short two-word names.
