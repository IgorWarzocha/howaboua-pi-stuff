# Upstream synchronization

The contract follows OpenAI Codex web search at commit b545c94041017d000e2c8b2f6272705d21b85dfb.

The upstream source is `codex-rs/ext/web-search/`, `codex-rs/codex-api/src/endpoint/search.rs` and `codex-rs/codex-api/src/search.rs` in [OpenAI Codex](https://github.com/openai/codex). Use Git at the revision above for the baseline, then compare relevant changes. `upstream/` retains attribution and the revision only. The executable implementation is TypeScript: it preserves Codex alpha/search requests, explicit search/navigation commands, proxy routing, and reusable result references without bundling the Rust client.

## September 28 review

Reviewed through Codex `1b1835f751ebdc0cfc50b3fe55d4571dbb294563`; the reference baseline remains the revision above.

HTTP redirects resolve proxy and `no_proxy` routing for each destination, following the route-aware transport change in `6ea62c4396`. ChatGPT redirect bounds, cookie handling and cross-origin credential stripping remain enforced. The runtime remains identical to the image-generation package's copy.
