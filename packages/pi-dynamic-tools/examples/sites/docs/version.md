# Version operations

A saved version is a reviewable deployment candidate. Saving is not deployment.

## `version.list`

List saved versions for a Site. Use `limit` and `cursor` for pagination.

## `version.get`

Inspect one opaque `version_id` within its `project_id`.

## `version.save`

Run only after local validation and review. The facade:

1. finds the Git project from `project_dir` or the current directory;
2. requires a committed `.openai/hosting.json` bound to the Site;
3. requires a clean worktree, including no untracked files;
4. derives the exact HEAD commit SHA;
5. obtains a short-lived Sites repository credential;
6. pushes HEAD to the backend-selected source branch without exposing the token or running repository hooks;
7. saves that exact commit and returns the opaque `version_id` and user-facing version number.

Do not pass `commit_sha` or `archive`; the facade rejects both. It currently supports repository-backed saves, not uploaded build archives.

```js
await tools.sites(JSON.stringify({
  resource: "version",
  action: "save",
  params: { project_dir: "/absolute/project/path" }
}))
```
