---
name: project-reference-research
description: "Evidence-backed research in local or external repositories. Use for inspecting, comparing, or learning from a project, checkout, or GitHub URL."
---

# Project Reference Research

## Repository homes
- Prefer an existing local checkout when one is obvious from the current workspace or user-provided path.
- For new clones, use `~/Work` for the user’s own projects and `~/Frameworks` for third-party reference repos when those directories exist.
- If neither directory exists, clone under the current working directory or ask for a destination when the choice matters.

## Workflow
1. **Resolve the repo**
   - If the user gives a GitHub URL, use it.
   - If the user names a repo, first check the current workspace, `~/Work/<name>`, and `~/Frameworks/<name>` when those locations exist.
   - If there is no local match, infer the most likely GitHub repository from the user's wording and clone the best match.
   - Only ask for clarification if multiple matches look equally plausible or no credible repo can be found.

2. **Clone or update**
   - Use `~/Work/<repo>` for the user’s own projects when available.
   - Use `~/Frameworks/<repo>` for third-party repos when available.
   - If missing and a URL is known, clone it.
   - If present, check `git status --short`.
   - If clean, update the current/default branch.
   - If dirty, do not pull/reset/stash; use it as-is and mention that it was dirty.

3. **Choose the investigation mode**
   - Inspect directly when the repository is small, the question is precise, or the relevant source must remain in the main context for later reasoning or implementation.
   - If the relevant files and checks are already known, inspect them directly unless the delegated work is independently substantial.
   - Use a subagent when discovery is broad, the repository is large or unfamiliar, and a summarized evidence map can reduce noise without hiding context the main agent will still need.
   - Do not delegate merely because the project is external or because a subagent is available.
   - If delegating, choose shallow or deep exploration to match the scope. Give the subagent the repo path, exact question, boundaries, desired evidence, and “do not edit files”.

4. **Investigate and verify**
   - Read the relevant source directly, whether discovered by the main agent or identified by a subagent.
   - Verify the important files behind delegated findings before making precise claims or using them in implementation.
   - Separate evidence from inference.
   - Prefer local file citations with line numbers.

## Safety
- Never overwrite, reset, stash, clean, or switch branches in a dirty referenced repo without explicit approval.
- Do not edit the referenced repo; it is context only.
- Keep exploration proportional. Use multiple subagents only when independent workstreams and repository scale make the split materially useful.

## Final answer
Include:
- repo path used
- whether it was cloned, updated, already present, or used dirty/as-is
- concise findings
- file path citations with line numbers where useful
- practical takeaways for the current task
