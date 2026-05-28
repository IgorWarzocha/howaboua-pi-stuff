# pi-explore-subagents

Give Pi a second set of eyes. `pi-explore-subagents` adds an isolated discovery tool that lets Pi send focused reconnaissance work to a child agent before the main agent edits anything. It is built for the moment when a codebase is unfamiliar, the right files are not obvious, or you want evidence gathered without dragging all of that exploration into the primary session.

## What it does

This package gives Pi agents a dedicated `explore_subagent` tool. It is not meant to be called directly by users; agents use it when they need isolated reconnaissance before acting.

The tool starts a separate, no-session Pi subprocess with a discovery-only prompt. The subagent can inspect files, trace relationships, and report back with paths, line ranges, unknowns, and suggested next reads. It does not inherit the parent conversation, and it is instructed not to edit files.

Use it for:

- finding the right entry points in an unfamiliar repo
- tracing a behavior across nearby files
- surveying a subsystem before implementation
- collecting evidence before making a change
- keeping broad exploration out of the main context

## Modes

`explore_subagent` has two modes:

### `shallow`

Fast, bounded reconnaissance. Use it with cheaper, faster, or less capable models when you only need hotspots, entry points, and the next few files to read.

Good for:

- quick orientation
- finding likely files
- narrow questions
- stopping early before the search sprawls

### `deep`

Wider reconnaissance for longer investigations. Use it with a stronger model when the task needs cross-file synthesis, triage, or a more complete map.

Good for:

- repo or subsystem surveys
- following call paths
- compare/rank/select work
- tracing config, scripts, tests, and boundaries

## Install

```bash
pi install npm:@howaboua/pi-explore-subagents
```

You can also clone the package and install your local copy if you want to tune the prompts or mode behavior for your own workflow.

## Configuration

On first use, the package creates `~/.pi/agent/pi-explore-subagents.json` with separate model settings for each mode. If an older local install already has a tuned package-local `config.json`, those settings are copied into the new user-local file first. A good starting point is to keep `shallow` fast and inexpensive, and reserve `deep` for longer work:

```json
{
  "shallow": {
    "model": "openai-codex/gpt-5.3-codex-spark",
    "thinking": "low"
  },
  "deep": {
    "model": "openai-codex/gpt-5.4-mini",
    "thinking": "medium"
  }
}
```

Edit that user-local file to tune models or thinking levels. It lives outside the installed package, so reinstalls and updates will not wipe your changes.

## Usage

Ask Pi naturally. The tool is for agents, not for direct user calls. When an agent uses it, it should provide a complete standalone brief, choose `shallow` or `deep`, and optionally set the working directory.

Because the subagent is isolated, the agent should include the context it needs in the task itself: project path, the exact question, relevant files or symbols, constraints, and the kind of evidence you want back.

Example:

> Use a shallow explore subagent to find where authentication errors are rendered. Stay discovery-only. Return likely files, line ranges, and the best next reads.

For broader work:

> Use a deep explore subagent to map the flow from CLI argument parsing to command execution. Include config and test boundaries. Stay discovery-only and return evidence by file and line range.

## In short

- `shallow` is for fast, bounded scans.
- `deep` is for wider, longer investigations.
- Subagents are isolated and discovery-only.
- Better briefs produce better evidence.
