# Rust Notes

Use this reference when applying agent-native hardening to Rust crates, Cargo workspaces, Rust CLIs/services, or repos with Rust FFI/native components.

Sources checked before writing this reference:
- Cargo Book: `cargo fmt`, `cargo check`, workspaces, resolver behavior
- Rustfmt project docs
- Rust Reference: undefined behavior and unsafe responsibilities
- Rust `core::error` docs
- Rust API Guidelines documentation section
- Asynchronous Programming in Rust guide

## Rust baseline discovery

Inspect before scoring or recommending lanes:
- `Cargo.toml` at root and member crates
- `[workspace]`, `members`, `default-members`, `resolver`, `[workspace.dependencies]`, `[workspace.lints]`, and feature flags
- `Cargo.lock` for apps/workspaces; do not delete or regenerate it casually
- `rust-toolchain.toml`, `rustfmt.toml`, `.rustfmt.toml`, `clippy.toml`, `.cargo/config.toml`, CI configs, and `Makefile`/`justfile`/`xtask` commands
- crate layout: `src/lib.rs`, `src/main.rs`, `src/bin/*`, `crates/*`, `examples/*`, `tests/*`, `benches/*`, `build.rs`
- generated code, bindings, or macros; confirm whether they are edited by hand before treating them as source hotspots

Common checks to identify or suggest:
- `cargo fmt -- --check`
- `cargo check --workspace --all-targets`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace --all-targets`
- `cargo doc --workspace --no-deps` when public API docs matter

Adjust flags to the repo's actual workspace/features. Do not blindly run `--all-features` if features are mutually exclusive or intentionally platform-specific.

## Rust risk signals

Penalize these when they appear in core paths:
- giant `lib.rs`, `main.rs`, `mod.rs`, `error.rs`, `state.rs`, `util.rs`, or `prelude.rs` files that absorb unrelated concerns
- root modules that own routing, IO, domain rules, state mutation, async task orchestration, and rendering/serialization at once
- broad traits used as abstraction theater instead of stable extension points
- error types that erase actionable failure modes too early in library/public boundaries
- `unwrap`, `expect`, `panic`, or `todo!` in recoverable runtime paths
- `Option` used where a failure reason should be modeled as `Result`
- primitive soup: repeated `String`, `PathBuf`, `usize`, IDs, units, or raw bytes with no domain wrapper or validator where values can be mixed up
- feature flags that create untested build combinations or hide cross-crate coupling
- `unsafe` blocks without local safety comments/invariants and safe wrappers that do not enforce the unsafe contract
- async tasks spawned without ownership, cancellation, shutdown, or error propagation paths
- blocking IO or CPU-heavy work inside async tasks without an explicit blocking boundary

## Strong Rust patterns

Prefer these when hardening Rust code:
- small crates/modules with `lib.rs` as a map and thin public entrypoint, not a dumping ground
- domain modules that keep types, parsing/validation, pure transforms, and tests near the owned behavior
- explicit enums for state machines and lifecycle transitions
- newtypes for IDs, paths, units, validated strings, external references, and ambiguous numeric values
- `Result` with meaningful error variants at boundaries where callers can react
- app/CLI binaries that delegate to library modules so logic is testable without process spawning
- integration tests for public behavior and unit tests for pure transforms, parsers, state machines, and error mapping
- narrow trait boundaries introduced for real polymorphism, test seams, or external adapters, not preemptive genericity
- documented `unsafe` invariants and safe APIs that prevent callers from violating them

## Error handling guidance

Rust's standard docs distinguish anticipated runtime failures from bugs: use `Result` and error types for expected failures; reserve panic paths for bugs or impossible states.

Hardening recommendations:
- keep rich domain errors inside libraries and public boundaries
- convert to user-facing reports near CLI/service edges
- avoid erasing errors too early if downstream code needs to branch on them
- prefer `?` and small conversion helpers over large nested `match` blocks when it improves readability
- document public failure behavior, panics, and safety notes where relevant

Do not force one error crate across a repo unless the user accepts that modernization lane. Respect existing conventions unless they are causing drift, unreadable boundaries, or poor diagnostics.

## Async Rust guidance

Async Rust needs explicit lifecycle ownership. During inspection, look for:
- `tokio::spawn` or runtime-specific spawn calls whose handles are dropped or ignored
- channels with unclear close/shutdown behavior
- background tasks that log errors but never report failure to the owner
- cancellation paths that leave partial writes, locks, temp files, or external resources in unclear states
- blocking calls inside async tasks

Hardening patterns:
- one owner for task startup, shutdown, and error collection
- explicit cancellation/shutdown messages or tokens where the runtime/ecosystem supports them
- structured task groups or owned join handles rather than fire-and-forget tasks
- deterministic async tests with controlled time/resources when possible
- small async orchestration functions that delegate pure transforms to synchronous code

## Unsafe and FFI guidance

`unsafe` means the compiler cannot verify the memory-safety contract; it does not make undefined behavior acceptable. Treat unsafe and FFI as high-signal inspection areas.

For each unsafe hotspot, check:
- is the unsafe block/module isolated from business logic?
- are safety invariants written next to the unsafe operation or public unsafe API?
- does the safe wrapper enforce the required preconditions?
- are lifetimes, aliasing, ownership, thread-safety, and panic/drop behavior considered?
- are generated bindings or external C APIs clearly separated from domain logic?

Recommend `forbid(unsafe_code)` or narrower unsafe isolation only as an opt-in modernization lane unless the repo already follows that policy.

## Rust modernization suggestions

After inspection, suggest these only as optional lanes unless the user already asked for upgrades:
- update to the current stable Rust toolchain after checking official Rust release/toolchain sources
- adopt the latest appropriate Rust edition and Cargo resolver for the repo's MSRV/product constraints
- centralize workspace dependencies/lints where it reduces drift
- strengthen `clippy` and `rustfmt` gates in CI/check scripts
- add `cargo deny`, audit tooling, or MSRV checks when supply-chain or compatibility risk matters

If the user accepts a modernization lane, do it cleanly. Do not make Rust checks pass by weakening lints, adding broad `allow` attributes, hiding warnings, downgrading editions/toolchains, scattering `unwrap`/casts, or avoiding the refactor that stricter checks exposed.

## Source anchors

- Cargo fmt command: https://doc.rust-lang.org/cargo/commands/cargo-fmt.html
- Rustfmt usage/configuration: https://github.com/rust-lang/rustfmt
- Cargo check command: https://doc.rust-lang.org/cargo/commands/cargo-check.html
- Cargo workspaces: https://doc.rust-lang.org/cargo/reference/workspaces.html
- Cargo dependency resolver: https://doc.rust-lang.org/cargo/reference/resolver.html
- Rust error handling docs: https://doc.rust-lang.org/core/error/index.html
- Rust API Guidelines documentation: https://rust-lang.github.io/api-guidelines/documentation.html
- Rust Reference undefined behavior: https://doc.rust-lang.org/reference/behavior-considered-undefined.html
- Async Rust guide: https://rust-lang.github.io/async-book/part-guide/more-async-await.html
