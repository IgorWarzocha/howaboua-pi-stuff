Treat manifests, lockfiles, CI actions, installers, build scripts, compiler plugins, generators, and package-manager lifecycle hooks as supply-chain code that may execute.

Do not run new or untrusted dependency code merely to inspect a repository. Avoid first execution in environments carrying broad SSH keys, GitHub tokens, package-publishing credentials, cloud access, production secrets, or unrelated repository access.

Dependency, runtime, compiler, package-manager, lockfile, CI-action, and lint-policy changes are explicit modernization work. Investigate relevant currency and compatibility, explain migration risk, and ask before changing them. Do not bulk-update or move everything to latest by default.

For an accepted dependency change:

- confirm the exact package, action, publisher, repository, and intended version
- inspect install, build, prepare, post-install, generation, plugin, native binary, and download behavior
- check ownership changes, suspicious releases, typosquatting, source transparency, provenance, and transitive footprint proportionately to risk
- read migration guidance for the versions crossed
- preserve deterministic install and lockfile policy
- keep resolver churn limited and reviewable where the ecosystem permits it
- account for tools that import compiler or package APIs programmatically
- run the affected type, contract, test, build, and runtime checks

Security audits, signatures, checksums, and provenance are signals, not proof. A maintainer account, CI system, release tag, or publishing token can be compromised while artifacts still look legitimate.

Treat mutable CI action tags and reusable workflows as code. Pin or constrain them according to repository policy and threat model. Review the action source together with the permissions and secrets available to the job.

Assume package installation and compilation can execute attacker-controlled code. Build scripts, native components, downloaded CLIs, and compiler plugins may run before application tests. One compromised credential or maintainer can publish across many packages and repositories quickly.

Where supported and proportionate, consider script blocking, narrow allowlists, immutable installs, checksums, signatures, provenance, vendoring, sandboxed builds, private mirrors, delayed update windows, and isolated publishing environments. Do not silently impose a new security policy.

Never make an update pass by weakening strictness, adding broad suppressions, skipping affected code, hiding failures, or deleting lockfiles casually. Separate required security or compatibility fixes from optional modernization.
