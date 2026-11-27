---
"@howaboua/pi-shepherdr": patch
---

- Breaking: `send` takes `task` to delegate supervised work, or `message` to send a peer message. Use `wait: true` to wait for a task. Removed `assign`.
- Breaking: `watch` requires `enabled: true` or `false`. Removed `unwatch`.
- Breaking: `sharing` takes `operation: "attach" | "detach"` and `scope: "context" | "board" | "both"`. Removed the separate `attach` and `detach` actions.
- Clarified when to use `agents`, `hc` and `herdr-app`.
