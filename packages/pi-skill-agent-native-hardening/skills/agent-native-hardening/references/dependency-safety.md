# Dependency and Toolchain Safety

Read this reference when dependency manifests, lockfiles, package managers, installers, lifecycle hooks, runtimes, compilers, or third-party tooling are in scope.

## Scope and approval

- Treat dependency, runtime, compiler, package-manager, lockfile, and lint-policy changes as explicit modernization work.
- Do not bulk-update or “move everything to latest” unless the user accepted that exact scope and risk.
- Prefer the smallest targeted change that serves the accepted objective.
- Keep manifest and lockfile diffs reviewable; avoid unrelated resolver churn where the package manager permits it.
- Respect deterministic install modes and the repo's existing lockfile policy. Do not delete or regenerate lockfiles casually.

## Code-execution surfaces

Treat these as code execution, not passive metadata:

- install, build, prepare, post-install, and lifecycle scripts
- package-manager plugins and global installers
- code generators, compiler plugins, and build scripts
- downloaded CLIs, native binaries, prebuilt artifacts, and opaque wrappers
- dependency code executed in developer machines or CI

Do not run new or untrusted dependency code merely to inspect a repo. Avoid first execution in environments carrying broad SSH keys, cloud credentials, publish tokens, production access, or unrelated secrets.

## Evaluating a new dependency

Check proportionately:

- whether the dependency is necessary or existing code/tooling already covers the need
- exact package identity, repository, publisher, and signs of typosquatting or name confusion
- unexpected maintainers, ownership changes, abandoned-then-revived activity, or surprising fresh releases
- install/lifecycle scripts, downloaded binaries, generators, native components, and network behavior
- source transparency, release provenance, signatures/checksums where supported, and whether artifacts correspond to source
- maintenance health, compatibility policy, transitive footprint, and exit cost

Security audits and provenance are useful signals, not proof of safety. Known-vulnerability tools can miss new supply-chain attacks, and a compromised maintainer or CI system may still publish apparently valid artifacts.

## Update strategy

- Verify current versions and migration guidance from official sources before making concrete recommendations.
- Prefer staged, targeted updates over fresh-release chasing, especially across many packages or maintainers.
- Separate required security/compatibility fixes from optional modernization.
- Read changelogs and migration notes for the versions actually crossed.
- Run the repo's relevant build, contract/type, test, and runtime checks after accepted changes.
- Never make an upgrade pass by weakening checks, adding broad suppressions, hiding failures, or skipping affected code.

## Ecosystem safeguards

Where the ecosystem supports them, consider script blocking, narrow allowlists, checksums, signatures, provenance, vendoring, sandboxed installs, private mirrors, frozen/immutable lockfile modes, or delayed update windows. Recommend these according to the repo's threat model; do not silently impose them.

Assume blast radius matters in worm-like package campaigns: one compromised maintainer or package can republish across many dependents quickly. Keep credentials narrow, update sets reviewable, and publish/install environments isolated where practical.
