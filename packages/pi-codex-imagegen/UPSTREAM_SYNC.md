# Upstream synchronization

The contract follows OpenAI Codex image generation at commit b545c94041017d000e2c8b2f6272705d21b85dfb.

The TypeScript implementation uses `gpt-image-2.5` instead of the snapshot's `gpt-image-2`.

Reference snapshots live under upstream/. The executable implementation is TypeScript: it preserves Codex generation/edit selectors, native image endpoints, response metadata, and workspace-local artifacts without bundling the Rust client.

## September 28 review

Reviewed through Codex `1b1835f751ebdc0cfc50b3fe55d4571dbb294563`; reference snapshots remain pinned to the revision above.

- `transparent_background` follows `40eac3ce8a`: true requests transparency for generation or editing; omission or false requests an opaque background. This replaces the previous automatic background selection.
- HTTP redirects resolve proxy and `no_proxy` routing for each destination, following the route-aware transport change in `6ea62c4396`. The runtime remains identical to the web-search package's copy.

Live `gpt-image-2.5` endpoint checks on 2026-09-28 confirmed real alpha pixels, not just an accepted parameter: generation had 76.69% fully transparent pixels and an edit had 61.66%. The opaque control had no transparent or partially transparent pixels. These samples establish endpoint support, not a guarantee for every prompt.
