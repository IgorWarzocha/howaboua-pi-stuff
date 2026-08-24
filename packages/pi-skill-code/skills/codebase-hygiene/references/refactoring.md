Read the implementation, complete owning files, consumers, types, tests, and runtime edges before editing. Existing code and tests reveal current behavior and assumptions, not necessarily the contract worth preserving. Run relevant checks during and after the change. Do not create a ceremonial baseline document.

Describe the target in operational terms:

- one owner for each moved responsibility and invariant
- allowed import direction
- visible composition and runtime selection
- public contracts that remain stable
- internal consumers that must migrate
- old paths that must disappear

Reject a target that only rearranges folders or adds forwarding layers. An extraction must improve ownership, change locality, contract enforcement, lifecycle, or traversability.

Order the migration so the repository stays coherent:

1. Expose the intended owner or boundary without duplicating policy.
2. Move one coherent responsibility or consumer slice.
3. Switch imports, composition, registration, and runtime dispatch.
4. Migrate all owned consumers and tests.
5. Remove the old implementation, obsolete exports, temporary adapters, and duplicate tests.
6. Re-trace the final call and import path, then run the relevant aggregate checks.

Name the consumer supported by every temporary compatibility path and the step that removes it. Prefer an atomic migration when practical. Never leave old and new implementations as parallel authorities.

Apply transformation-specific judgment:

- **Splitting a file:** Split by owner, change reason, dependencies, or lifecycle. Do not create generic `helpers`, `common`, `types`, or one-use fragments.
- **Merging files:** Merge wrappers and microfiles that always change together and expose one another's internals. Preserve real package, effect, contract, or lifecycle boundaries.
- **Breaking a cycle:** Decide policy direction. Move orchestration upward or place a narrow capability with the policy that consumes it. Do not create an abstract dumping ground.
- **Inverting a dependency:** Keep volatile infrastructure construction at the composition root. Do not replace a direct dependency with a service locator.
- **Consolidating duplication:** Confirm the copies enforce the same invariant and should evolve together. Similar syntax is not enough.
- **Moving state:** Move mutation rules, synchronization, lifecycle, failure, and cleanup with the data. Moving only types does not move authority.
- **Crossing package or service boundaries:** Account for deployment, versioning, serialization, latency, failure, and ownership costs.

Internal types may change when all consumers migrate coherently and external behavior remains stable. Public APIs, endpoints, serialized formats, persisted schemas, configuration, error contracts, and operational signals remain stable by default. Separate an intentional contract migration from structural movement and obtain approval for its compatibility cost.

Search beyond direct imports before deleting or moving symbols. Check re-exports, reflection, dependency injection, plugins, generated bindings, build configuration, fixtures, scripts, documentation examples, and string-keyed registration supported by the runtime.

Keep behavior changes separate from mechanical movement. If a bug is discovered, make the correction explicit and test the real failure mechanism. Do not preserve a misleading test merely because it matches the old implementation.

Completion requires:

- focused contract and behavior checks pass
- required type, lint, build, and aggregate checks pass
- no stale import, export, registration, adapter, or implementation remains
- dependency and execution topology match the intended owner
- supported consumers use one authority
- the final diff contains no incidental modernization, broad cleanup, or generated churn

If a consequential check cannot run, name the unchecked contract and do not claim full preservation.
