# pi-auto-reasoning-tool

A small [Pi](https://pi.dev) package that lets agents adjust their own reasoning level with a `change_reasoning` tool.

The tool is intentionally minimal: the agent chooses `low`, `medium`, or `high`. The user's level at the start of the turn is the floor, so an agent can spend more effort but cannot quietly reduce a user-selected `high`, `xhigh`, or `max` level.

Pi restores the original level after the full run settles, including retries, overflow compaction, and queued continuations.

## Why

Pi already supports reasoning levels. This package exposes a narrow agent-callable tool so the agent can raise its budget when work becomes harder, return after an earlier increase, and then hand control back to the user's baseline.

Agents cannot select `xhigh` or `max`. Users can still select either level themselves, and the extension preserves it.

The prompt is conservative: agents are told to use the tool sparingly and preferably in parallel with other useful tool calls, avoiding standalone reasoning-change turns.

## Install

```bash
pi install npm:@howaboua/pi-auto-reasoning-tool
```

Or add it to your Pi settings:

```json
{
  "packages": ["npm:@howaboua/pi-auto-reasoning-tool"]
}
```

Then restart Pi or run `/reload`.

## Tool

Registers one tool:

```text
change_reasoning
```

Parameters:

```text
level: low | medium | high
```

Behavior:

1. Agent chooses `level`.
2. Extension keeps the higher of the requested level and the user's turn baseline.
3. Extension calls `pi.setThinkingLevel()` with that safe level.
4. Tool result reports the requested, previous, baseline, and applied levels.
5. If Pi clamps the level because of model capability, the result says so.
6. On `agent_settled`, the extension restores the original baseline.

## Agent-facing prompt copy

Description:

> Temporarily adjust reasoning up to high without lowering below the user's turn baseline.

Prompt snippet:

> Adjust reasoning effort within the user's safe baseline.

Guidelines:

> Treat the user's current turn level as the baseline; call only to increase effort for harder work or return after an earlier increase.

> Autonomous choices are low, medium, and high; the extension never lowers below the user baseline or selects xhigh/max.

> Use change_reasoning sparingly; avoid standalone calls when another useful tool call can run in parallel.

> Use medium for complex single tasks, feature planning, or multi-step implementation.

> Use high for multi-area architecture work, hard debugging, or unexpectedly difficult tasks.

Parameter:

`level`

> Reasoning level to use for this task: low, medium, or high.

## Development

```bash
npm install
npm run check
pi -e ./src/index.ts
```

## Publish

```bash
npm publish --access public
```

## License

MIT
