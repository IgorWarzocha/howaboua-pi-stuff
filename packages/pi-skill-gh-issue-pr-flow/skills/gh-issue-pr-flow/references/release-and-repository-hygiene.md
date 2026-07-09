# Release and Repository Hygiene

Read this reference only when preparing shipped package work, release readiness, changelogs, versions, or repository funding metadata.

## Existing release systems win

Inspect repository instructions and release configuration before changing package metadata. Changesets, release-please, semantic-release, monorepo orchestration, and custom release branches each expect different PR artifacts.

- Use the repository's existing release command or metadata format.
- Do not manually bump versions or aggregate packages when automation owns them.
- Include lockfile or generated metadata changes only when the established workflow produces or requires them.
- If release handling is intentionally deferred to merge or a release PR, prepare the expected release artifact rather than inventing a manual bump.

## Manual npm fallback

Use this only when an npm package is intended to ship and no repository-specific release system exists.

1. Determine the concrete target version from compatibility and user-visible impact.
2. Use the package's documented version command. For a simple package with no wrapper, `npm version <version> --no-git-tag-version` is the fallback.
3. Keep package metadata and lockfiles consistent.
4. Ask before changing versions when release intent or compatibility impact remains genuinely unclear.

Do not bump a package merely because its current version is old or because a PR exists.

## Changelog policy

- Match the repository's existing changelog location and style.
- Do not add an `Unreleased` section unless the repository explicitly uses one.
- For a manual release fallback, add the concrete target version and factual user-visible bullets.
- For several tiny corrective releases that would create noisy one-line entries, a version range such as `## 0.1.2-0.1.4` may summarize the related fixes.
- Never invent release history or detailed claims unsupported by tags, published versions, release notes, package metadata, or commits.

If no changelog exists, create one only when it is useful for the repository. Retrospective entries may be reconstructed from reliable npm versions, tags, GitHub releases, and release commits; keep sparse history broad and honest.

## Repository funding metadata

When the user asks for repository hygiene, release readiness, or funding metadata, check whether `.github/FUNDING.yml` exists and contains a value.

- Do not add or guess a funding service or handle without user-provided or repository-documented evidence.
- Follow GitHub's supported funding-file shape.
- Do not put sponsor-check status in PR bodies.
- Do not report a successful sponsor check in the final summary; report only a missing or actionable problem.
