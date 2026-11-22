---
"@howaboua/pi-shepherdr": patch
---

- Shepherdr settings distinguish delegation guidance from starting workers and explain what adding an SSH connection does.
- Agent discovery shows the local Herdr Core name and accepts it as a machine selector.
- Agent discovery no longer presents remote hostnames as connection targets. Use the machine label or ID from `list`.
- Agent help always uses compact guidance and distinguishes the Core terminal manual from the Herdr window manual.
