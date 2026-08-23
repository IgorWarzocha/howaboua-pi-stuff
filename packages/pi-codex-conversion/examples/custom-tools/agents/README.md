# Agents

The `agents` example starts persistent explorer and reviewer Pi agents in Herdr panels, then finds, messages, reads, and answers them through one small custom-tool surface.

Copy `agents.toml` and the `agents/` directory together into the custom-tool directory. The local calling Pi must run inside Herdr.

The bundled explorer and reviewer profiles are fixed. Call `await tools.agents("help")` to inspect the current actions and profiles before spawning one.

## Remote routing

Local operation needs no configuration. Remote `desktop`, `laptop`, or `server` routing is disabled until the installer configures:

- `AGENTS_REMOTE_SOCKET_PATH` for the remote Herdr socket
- `AGENTS_REMOTE_TOOL_PATH` for a remote copy of `agents.mjs`
- `AGENTS_REMOTE_COORDINATION_TOOL` for the remote coordination helper

Remote hosts must already accept noninteractive SSH. The example does not copy files or configure remote Herdr instances.
