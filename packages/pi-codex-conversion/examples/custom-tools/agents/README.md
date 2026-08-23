# Agents

Use when the user wants persistent explorer or reviewer agents in Herdr panels. Start with `await tools.agents("help")` to inspect the fixed profiles and available actions.

Give a spawned agent only its concrete task and inaccessible context. Explorer and reviewer profiles are read-only. Reuse an explorer only for the same investigation. Keep reviewers independent.

Use the exact target returned by `spawn` or `find` for later `send`, `read`, or `answer` calls. Leave `blocking` enabled for requested findings or answers. Use `blocking: false` only while continuing other work before a later read.

The local caller must run inside Herdr. Remote routing is unavailable until an installer explicitly configures it. Do not configure remote hosts, copy files, or alter Herdr setup unless the user asked for that work.
