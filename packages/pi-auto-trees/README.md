# @howaboua/pi-auto-trees

Adds three commands for carrying useful context through long Pi sessions without keeping every dead end and debugging turn.

## Install

```bash
pi install npm:@howaboua/pi-auto-trees
```

Try it for one session:

```bash
pi -e npm:@howaboua/pi-auto-trees
```

## Usage

1. Run `/prime <scope>` to orient the agent on a repository area. When the agent fully settles, the extension marks the resulting conversation point automatically.
2. Complete a coherent chunk of work.
3. Run `/end`.

`/prime` defaults to the current repository when no scope is supplied. It can be repeated for different scopes; each completed priming turn gets its own marker.

`/prime` asks the agent for a concise orientation briefing and does not ask it to implement anything. The automatic marker is set only after Pi reports that the agent is fully settled, including any retry or compaction work.

Use `/marker` to mark the current conversation point without a priming turn. It waits for Pi to become idle before setting the checkpoint.

`/end` summarizes the conversation since the marker, navigates back to that point, carries the summary forward, and advances the marker. It uses Pi's normal summary guidance, without assuming the conversation is about coding.

With Pi Codex context management active, `/end` asks the current agent to save that conversation summary through the active notes backend. The save ends the agent turn without a follow-up reply. The destination receives a branch summary directing the agent to read the note before resuming. Auto Trees remains standalone when context management is inactive.

### `/end` modes

- `/end` — summarize the conversation since the marker
- `/end git` — also capture the commit that should be made
- `/end full` — equivalent to `/end`
- `/end <guidance>` — add a custom focus, for example `/end focus on API changes and migration notes`

The marker is stored in the session branch and restored when you return to it. Existing labels are preserved if the checkpoint already has one.

## Configuration

On first load, the extension creates `~/.pi/agent/pi-auto-trees.json`, or the equivalent path under `$PI_CODING_AGENT_DIR`.

```json
{
  "summary": {
    "enabled": true,
    "model": "openai-codex/gpt-5.6-luna",
    "thinking": "low"
  }
}
```

`/end` uses the configured lightweight model for ordinary branch summaries, not managed notes handoffs. If that model or its credentials are unavailable, the extension reports the fallback and uses Pi's current session model.

## Local development

```bash
bun install
bun run check
bun run pack:dry
pi -e ./index.ts
```
