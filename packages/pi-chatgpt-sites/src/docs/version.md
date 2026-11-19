# Versions

`version.list` paginates saved candidates. `version.get` inspects an opaque `version_id`; use the user-facing version number in prose.

`version.save` saves source without deployment. `version.publish_private` saves and deploys atomically. Before publishing, you MUST know the user's request covers production publication and the selected account's access is owner-only. If access is unknown, read `site.get` first.

Both routes require committed `.openai/hosting.json` and a clean Git worktree, including untracked files. They push exact HEAD without running repository hooks. Caller-supplied `commit_sha`, `archive` and `publish_on_push` are rejected. An auto-publishing credential is refused before push.

Both routes use remote build fallback. Pi cannot upload a build archive. You MUST NOT substitute a local tar path, fake `file_id` or `download_url`, or an invented upload endpoint. If fallback cannot build the project, report the missing upload capability. Static-only Sites remain valid builds.

Use `deployment.deploy` for an existing saved version. If atomic publication returns `error.details.saved_version_id`, keep it and retry deployment only after resolving the cause. After `site_not_owner_only`, reread `site.get`. You MUST NOT change access or silently fall back to shared deployment.
