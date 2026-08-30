# Custom tool examples

Read when a user asks to configure one of these disabled examples. Do not enable an example merely because it exists.

| Example | Use when |
| --- | --- |
| `agents` | The user wants persistent explorer or reviewer agents in Herdr panels |
| `browser` | The user wants evidence or interaction from an existing logged-in CDP browser |
| `skills` | Pi was launched with `--no-skills` and the agent needs on-demand global or project skills |
| `port_info` | A process or listener needs identifying |
| `semantic_grep` | An installed Pi Semantic Grep index needs querying |
| `sites` | The user asks to manage a ChatGPT Site |
| `spawn_agent` | The user wants an isolated one-shot explorer or reviewer |
| `vent` | Repeated workflow friction belongs in `VENT.md` |
| `workflows_create` | The user confirms a repeatable repository procedure |

An example consists of its top-level TOML definition and any companion directory. Keep that layout together when configuring it.

## Skills

The `skills` example assumes Pi was launched with `--no-skills`. It reads the normal global catalog, the current repository's `.pi/skills/` addenda and one or more references by name. A same-named session skill overrides the global skill.

Do not use it in a session where Pi loaded native skills at startup. The tool would repeat those instructions when reading a skill.

## Sensitive examples

`browser` controls an existing logged-in browser. `agents` affects other Pi sessions. `sites` can create production deployments and change access, environment, or domains. Follow its verification and repair loop in `sites/README.md`, then follow user intent and ask before consequential external actions.
