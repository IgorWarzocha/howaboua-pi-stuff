# Sites workflow

Sites publishing has two separate stages: save a version, then deploy that saved version. Every deployment URL is production.

## Existing local project

1. Confirm the project can produce a Sites-compatible build and validate it locally.
2. Commit all intended source. `version.save` rejects dirty or untracked worktrees.
3. If `.openai/hosting.json` has no `project_id`, call `site.create` once. The facade writes the returned ID into that file without replacing other bindings.
4. Call `version.save`. The facade derives HEAD, obtains a temporary repository credential, pushes that exact commit internally, and saves it. Saving does not deploy.
5. Review the saved candidate.
6. Call `deployment.deploy` only when production publication is intended.
7. Poll `deployment.status` when the initial deployment is non-terminal.

## Invariants

- Treat project, version, deployment, domain, and cursor IDs as opaque.
- Never call `site.create` when `.openai/hosting.json` already has `project_id`.
- Never treat a local build or Git commit as a saved `version_id`.
- Never deploy an unsaved version.
- Keep runtime secrets out of prompts, source, `.env.example`, and `.openai/hosting.json`.
- Prefer the narrowest access mode that fits the audience.

If the backend returns `terms_required`, give the URL to the user. They must accept the ChatGPT Sites publication terms in a browser, then retry the operation.
