# Versions

`version.list` paginates saved candidates. `version.get` inspects an opaque `version_id`; use the user-facing version number in prose.

`version.save` saves source without deployment. `version.publish_private` saves and deploys that source atomically through `save_version_and_deploy_private`. Use the latter only for intended production publication already known owner-private for the selected account, never to probe access. No shared fallback is attempted.

Both routes require committed `.openai/hosting.json` and a clean Git worktree, including untracked files. The facade derives HEAD, obtains a temporary credential, pushes that exact commit without repository hooks, then calls the chosen backend tool. Caller-supplied `commit_sha`, `archive` and `publish_on_push` are rejected. An auto-publishing credential is refused before push.

Archive support is deliberately absent: native `openai/fileParams` upload metadata does not give Pi an uploader. Never pass a local tar path as a remote archive, construct fake `file_id`/`download_url` values, or invent an upload endpoint. These source-only calls depend on remote build fallback. If fallback cannot build the project, report the missing upload capability. Static-only Sites remain valid builds.

For an existing saved version, use `deployment.deploy`, not another save. An atomic failure may return `error.details.saved_version_id`; retain it and retry only deployment after resolving the cause. After `site_not_owner_only`, reread access without changing audience or silently falling back.
