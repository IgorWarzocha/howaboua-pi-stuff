# h-stack

Portable Cursor skills for maintained code, agent harnesses, and a voice that belongs to the repository you are in.

Cursor discovers the skills from `skills/`. The only command is `/tune-comms`.

## Skills

| Skill | Use it for |
|---|---|
| `agents-md` | Creating, auditing, or revising an `AGENTS.md` file |
| `skill-creator` | Creating or revising a reusable agent skill |
| `instruction-calibration` | Empirically tuning a reusable skill or agent prompt |
| `prompt-caching` | Designing, measuring, or debugging prompt-cache behaviour |
| `agent-tool-design` | Creating, reviewing, or refining a tool an agent can call |
| `extension-design` | Creating or refining a coding-agent extension |
| `harness-checklist` | Auditing a coding-agent harness and recommending improvements |
| `agent-session-diagnostics` | Diagnosing a session, or a recurring skill or tool failure |
| `code-review` | Reviewing or accepting maintained-code changes |
| `codebase-hygiene` | Working on maintained code. Language, testing, refactoring, and dependency references live beside the skill |
| `repository-delivery` | Commits, GitHub issues, and pull requests, with references for issues and pull requests |
| `communication` | The source `/tune-comms` reads. It is not an always-on skill |
| `writing` | Drafting and editing prose, interface copy, and technical documentation |
| `non-code-review` | Reviewing documents, plans, proposals, and designs |

## Tune the voice

`/tune-comms` reads the plugin's communication and writing guidance and writes a durable voice for the repository you are in.

It infers what that repository is about. A games catalogue repo would tune toward a gaming voice using these principles, not a generic assistant voice. The command uses a domain reference only when one already belongs to that subject. It does not invent a gaming file.

The tune is saved where this Cursor surface already keeps durable instructions. That is a project rule or `AGENTS.md` when that is the repository's agent contract, or the cloud project store when this is a Cursor cloud project. The command does not open a branch or pull request just to save the tune.

## Install

Listing on the Cursor Marketplace is a manual review. Submit this repository at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). Cursor reviews it before the plugin is listed. This plugin is not an npm package. A changeset will not publish it.

After it is listed, install h-stack from the Marketplace. A team marketplace import of this repository also installs only `h-stack`, because the root marketplace manifest lists only that plugin.

`h-pi-stuff-stack` is not listed. A marketplace install does not include it. This repository loads those skills from `.cursor/skills/`.

To try it before that review, copy this plugin directory into Cursor's local plugin imports and reload the window. Copy the files. Cursor rejects a symlink that points outside the plugin directory, and a marketplace install copies only the plugin tree.
