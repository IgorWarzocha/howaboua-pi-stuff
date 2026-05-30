# Go Notes

Use this reference when applying agent-native hardening to Go repos, including single-module apps, multi-module workspaces, CLIs, services, libraries, and concurrent systems.

## Source anchors

These notes are based on current official Go documentation and maintained Go tooling docs:
- Go Modules Reference: modules, `go.mod`, `go.work`, and workspace behavior: https://go.dev/ref/mod
- Go command docs: `go fmt`, `go vet`, coverage, and command tooling: https://go.dev/doc/cmd
- Go vulnerability management and `govulncheck`: https://go.dev/doc/security/vuln/
- Go fuzzing: https://go.dev/doc/security/fuzz/
- Go race detector: https://go.dev/doc/articles/race_detector.html
- `context` package docs: cancellation, deadlines, and request-scoped values: https://pkg.go.dev/context
- `errors` package docs: wrapping, `Is`, `As`, and `Join`: https://pkg.go.dev/errors
- `testing` package docs: subtests, `Cleanup`, `TempDir`, fuzz targets, and test helpers: https://pkg.go.dev/testing
- Staticcheck docs for optional third-party linting: https://staticcheck.dev/docs/

If recommending a Go version/toolchain upgrade, verify the current stable release from official Go sources before making the recommendation concrete.

## Scorecard naming

Use the main skill's `contract_safety` category. In Go, this is usually about explicit data models, narrow interfaces, error contracts, context/cancellation contracts, package boundaries, and avoiding unstructured `any`/map-shaped data.

## Go baseline discovery

Inspect:
- `go.mod`, `go.sum`, and any `go.work` / `go.work.sum`
- `cmd/`, `internal/`, `pkg/`, package directories, generated-code locations, and service entrypoints
- `Makefile`, `Taskfile.yml`, `magefile.go`, CI configs, Dockerfiles, and scripts wrapping Go commands
- lint/security configs such as Staticcheck, golangci-lint, `govulncheck`, or custom vet tooling
- generated files marked with `// Code generated ... DO NOT EDIT.`; confirm they are generated before scoring them as hotspots

Common checks:
- `go test ./...`
- `go test -race ./...` for concurrency-sensitive packages when runtime cost is acceptable
- `go test -cover ./...` or package-specific coverage commands
- `go vet ./...`
- `go fmt ./...` / `gofmt` checks
- `staticcheck ./...` when installed or already used
- `govulncheck ./...` when security/dependency checking is in scope
- `go mod tidy` as a consistency check, but do not casually rewrite module files without user approval or a clear lane

## Common Go risk signals

Penalize these strongly when they appear in central paths or public contracts:
- godpackages with mixed HTTP, persistence, domain logic, configuration, and background worker code
- large `main.go`, `server.go`, `service.go`, or `handler.go` files that accumulate unrelated feature branches
- catch-all `util`, `utils`, `common`, `shared`, or `pkg` folders without a domain/platform owner
- broad interfaces defined by consumers before a real boundary exists, or interfaces with many unrelated methods
- interface{} / `any`, `map[string]any`, raw JSON maps, or loose `context.Value` plumbing used as domain models
- positional slices/arrays used as domain data, magic indexes, and parallel slices
- ignored errors, overwritten errors, `panic` in request/library paths, or logs without returning/handling the failure
- error wrapping that hides sentinel/type contracts, or exported wrapped errors that accidentally become API commitments
- goroutines started without ownership, cancellation, backpressure, bounded lifetime, or test visibility
- channels used as hidden global control flow instead of clear ownership/message contracts
- context stored on structs, passed as optional state, or used for required dependencies instead of cancellation/deadlines/request-scoped values
- package import cycles, package names that hide ownership, or cross-feature imports through central dumping grounds
- tests that depend on sleep timing, real network services, shared global state, or package execution order

## Strong Go patterns

Prefer these when hardening Go code:
- small packages with clear names and ownership; use `internal/` to enforce private boundaries when helpful
- command entrypoints in `cmd/<name>` that delegate to owned packages instead of containing product logic
- explicit structs for request/response/domain data instead of loose maps
- narrow interfaces at real boundaries, usually close to the consumer, with only the methods needed
- explicit error contracts: wrap with context where useful, preserve inspectable errors when callers depend on them, and document exported error behavior
- `context.Context` as the first parameter for operations that need cancellation/deadlines; propagate cancellation and always call cancel functions where required
- owned goroutine lifecycle: clear start/stop ownership, cancellation path, wait/join behavior, and bounded channels/queues
- table-driven tests for deterministic logic, with subtests for scenario names
- `t.Cleanup`, `t.TempDir`, and local test fixtures instead of manual global cleanup
- fuzz tests for parsers, encoders/decoders, protocol handlers, and validation logic with compact stable seeds
- race-detector lanes for concurrent code, especially worker pools, caches, maps, and shared mutable state

## Go package and boundary guidance

- Split by product/domain ownership before splitting by technical layer. A feature package with HTTP adapter, domain logic, and persistence adapter subfiles is often more traversable than global `handlers`, `services`, and `repositories` piles.
- Avoid `pkg/` as a default dumping ground. Use it only when the repo intentionally exposes reusable packages; otherwise prefer domain names or `internal/`.
- Keep generated code separate and clearly marked. Do not refactor generated output directly unless generation is broken or absent.
- Avoid package-level mutable state for configuration, clients, caches, or test toggles. Prefer explicit constructors and dependency injection at composition boundaries.
- Avoid circular dependency workarounds that create abstract `common` packages. Break cycles by clarifying ownership and moving contracts to the smallest stable boundary.

## Error handling guidance

- Do not ignore returned errors unless the ignored case is intentional and documented locally.
- Add context while preserving inspectability when callers need `errors.Is` or `errors.As`.
- Do not convert every error into strings at package boundaries; keep structured/sentinel/type information where callers need decisions.
- Avoid `panic` for ordinary runtime failures in libraries, handlers, workers, and request paths. Reserve it for impossible programmer errors or startup failures where crashing is the intended policy.
- Keep logging ownership clear: either handle/log at an edge or return the error upward, but avoid duplicated noisy logs at every layer.

## Concurrency and lifecycle guidance

- Every goroutine should have an owner, a cancellation/stop path, and a way to observe completion or failure when correctness depends on it.
- Prefer `context.Context` for cancellation/deadlines across API boundaries; do not use context values as a service locator or required argument bag.
- Avoid unbounded goroutine spawning, unbounded queues, and sends that can block forever during shutdown.
- Treat shared maps/caches/state as ownership hotspots. Use explicit synchronization or single-owner message loops, and test meaningful paths with `-race` when practical.
- Replace sleep-based tests with synchronization primitives, fake clocks, controllable channels, or injected dependencies.

## Go modernization suggestions

After inspection, suggest these only as optional lanes unless the user already asked for upgrades:
- update the Go toolchain and `go` directive to the current stable version after checking official Go sources
- add or strengthen `go vet`, `go fmt`/format checks, Staticcheck, `govulncheck`, race-detector lanes, or coverage/fuzzing where they fit the repo
- simplify module/workspace setup with clear `go.mod` / `go.work` ownership when multi-module development is genuinely needed
- add package-boundary rules through `internal/`, import linting, or CI checks when cross-feature imports are causing drift
- add deterministic CI commands that run the repo's chosen format, vet/lint, test, race/security, and build checks without hiding failures

If the user accepts one of these lanes, do the upgrade cleanly. Do not make Go checks pass by weakening lint rules, deleting useful tests, adding broad excludes, ignoring errors, replacing typed data with `any`, hiding concurrency bugs, or preserving a bad package boundary because it avoids refactoring.
