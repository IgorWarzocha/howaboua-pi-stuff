# Upstream synchronization

The contract follows OpenAI Codex web search at commit b545c94041017d000e2c8b2f6272705d21b85dfb.

Reference snapshots live under upstream/. The executable implementation is TypeScript: it preserves Codex alpha/search requests, explicit search/navigation commands, proxy routing, and reusable result references without bundling the Rust client.
