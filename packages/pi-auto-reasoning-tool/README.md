# @howaboua/pi-auto-reasoning-tool

Adds an agent-callable `change_reasoning` tool. The agent may raise its reasoning effort when the work gets harder, but the user's level at the start of the turn remains the minimum.

## Install

```bash
pi install npm:@howaboua/pi-auto-reasoning-tool
```

## Behavior

The tool accepts one parameter:

```ts
change_reasoning({ level: "low" | "medium" | "high" })
```

- Requests below the user's turn baseline keep the baseline.
- Users may select `xhigh` or `max`; agents cannot select those levels or lower them.
- Pi may clamp a requested level when the current model does not support it. The result reports the applied level.
- After the full agent run settles—including retries, compaction recovery, and queued follow-ups—the extension restores the user's turn baseline.

The model guidance asks agents to change reasoning by work phase, not around individual tool calls.

## Local development

```bash
bun install
bun run check
pi -e ./src/index.ts
```
