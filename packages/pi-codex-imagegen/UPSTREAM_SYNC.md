# Upstream synchronization

The contract follows OpenAI Codex image generation at commit b545c94041017d000e2c8b2f6272705d21b85dfb.

Reference snapshots live under upstream/. The executable implementation is TypeScript: it preserves Codex generation/edit selectors, native image endpoints, response metadata, and workspace-local artifacts without bundling the Rust client.
