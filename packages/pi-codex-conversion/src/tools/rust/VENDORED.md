# Native tool compatibility adaptations

The `UPSTREAM.apply-patch` and crate `UPSTREAM` files record the source
revisions imported from OpenAI Codex. Dependency updates do not change those
revisions or imply a newer upstream source import.

Local compatibility changes for the current registry dependencies are:

- `../apply-patch/rust/invocation.rs` uses Tree-sitter 0.27's
  `QueryMatch::captures()` accessor.
- `../apply-patch/rust/file_update.rs` selects Similar 3's `RawMyers` to
  preserve the previous minimal-diff algorithm.
- `crates/codex-utils-path-uri/{lib,api_path_string}.rs` use Schemars 1's
  public schema types and borrowed schema names. Both path wrappers still
  describe JSON strings.
- Workspace manifests select TS-RS 12, Base64 0.23, Dirs 7, LRU 0.19
  and SHA-1 0.11.
  The existing TS derives require no handwritten trait migration. Dirs is
  used only for `home_dir`, so its Windows `preference_dir` change does not
  move any paths here.

The source sync script replaces upstream Rust files. Reapply these local
compatibility changes after a sync unless the imported source already
supports the selected dependencies. Preserve the standalone CLI and
`pi-apply-patch-fs` adapters as before.
