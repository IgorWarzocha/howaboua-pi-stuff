# @howaboua/pi-explore-subagents

Adds an agent-callable `explore_subagent` tool for isolated, discovery-only codebase research. The child receives a standalone brief rather than the parent conversation and is instructed to inspect and report, not edit.

## Install

```bash
pi install npm:@howaboua/pi-explore-subagents
```

## Modes

- `shallow` — bounded reconnaissance for hotspots, entry points, narrow questions, and best next reads
- `deep` — broader surveys, cross-file tracing, triage, and compare/rank work

The tool accepts a required `task`, a required `mode`, and an optional `cwd`. Agents should include the background, exact question, scope, constraints, and expected evidence because the child has no inherited conversation.

Users normally ask Pi for an exploration rather than calling the tool directly:

> Use a shallow explore subagent to find where authentication errors are rendered. Stay discovery-only and return likely files, line ranges, and the best next reads.

## Configuration

On first use, the extension creates `~/.pi/agent/pi-explore-subagents.json`, or the equivalent path under `$PI_CODING_AGENT_DIR`.

```json
{
  "shallow": {
    "model": "openai-codex/gpt-5.6-luna",
    "thinking": "low"
  },
  "deep": {
    "model": "openai-codex/gpt-5.6-terra",
    "thinking": "low"
  }
}
```

Those are the package defaults; both models must be available in your Pi setup. Thinking levels through `max` are accepted and clamped to model capability. Existing package-local settings from older installs are migrated to the user config when possible.
