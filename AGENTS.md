Merges to `main` feed Changesets versioning and npm publishing.

We use this toolkit. If tools fail or cause friction, propose concrete fixes. Apply tiny, low-risk fixes without derailing the task. Edit owning source, never installed tooling. Report validation. Omit routine release and installation disclaimers unless asked or they change the next action.

Every package must work against released upstream Pi. Use supported extension APIs, never an upstream patch or fork. Every extension must install and run standalone. Discover optional integrations at runtime, never require them for core functionality.
Use released `@earendil-works/pi-schema` builders and validators, not TypeBox. Skills and extensions must work for any user. Do not ship personal names, local paths, machine assumptions or private workflows.
Check dependency currency before substantial merges. Pin direct npm and Cargo registry dependencies exactly. Keep npm peer ranges for supported host compatibility.
Resolve packages against immediate `packages/` subdirectories. Search the unique name fragment first, then follow direct references.

Run sandbox or live TUI reviews only when explicitly requested. Delegate to `sandbox-reviewer`, never run them in the parent. Programmatic probes need no sandbox and cannot substitute for consecutive real Pi turns through Herdr. For release acceptance, use the candidate's bundled native helpers without overrides.

Keep informational timestamps at minute precision without changing stored clocks or finer precision needed by behaviour or external contracts.
Delete permanent tests by default. Retain only consequential failure coverage that static checks and disposable probes cannot adequately provide. Add permanent tests only when explicitly requested.
Record fragile ownership and ordering in the nearest AGENTS.md, not a regression suite. Keep runtime validation in its owning code.
Establish actual exposure in supported workflows. A synthetic reproducer or possible interleaving alone is not enough. Weigh consequence against fix complexity. Optional capabilities are not defects. Cull scope before adding recovery or compatibility machinery.

Work on `dev` in the existing checkout by default. If the preceding `dev` → `main` PR merged, align after verifying all previous dev work was published. Preserve dirty files and unpublished commits. Never merge `main` into `dev`.
Ship unpublished dev work through one source PR unless explicitly split or deferred. Keep provisional edits local while direction is open. Batch settled follow-ups into validated pushes at natural checkpoints. Read new review comments before and after pushing, including bots. Fix concrete in-scope findings. Pushing does not authorise merging.
Amend only tiny, immediate, behaviour-preserving corrections to the latest unpublished commit. Use new commits for changed behaviour, revised approaches and later fixes.
Only Igor's explicit instruction authorises a major bump. Breaking changes or a general release request do not.
Keep exactly one changeset per changed extension when published behaviour or payload changes. Describe net user-facing differences, with breaking changes and migrations first. Use `.changesets-pending` for explicit deferrals. Ordinary docs, tests and dependency-only changes need none. CI owns aggregate versions and changesets.
