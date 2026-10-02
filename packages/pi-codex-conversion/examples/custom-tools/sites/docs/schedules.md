# Recurring updates

A schedule needs an active, published Site owned by the user, independently verified source access and an authenticated writer usable while the page is closed. Browser polling/WebMCP is not an unattended updater. D1, an MCP URL or a service credential alone proves neither source consent nor writer access. Use `mcp` when Site-hosted tools are needed. This facade redacts service credentials and does not supply an unattended writer.

Read fresh `site.get` metadata and linked `automations` first. Missing/null means unavailable: do not create or suggest schedules. Empty means no linked schedules, not proof an updater works. Reuse a matching automation, preserve paused state and use existing task tools for edits without losing the Site link.

`schedule.create` is for requested or accepted recurring work. Copy `schedule_request_id` to `request_id` unchanged. Supply `task` with `title`, a self-contained credential-free `prompt`, iCal `VEVENT` `schedule` and IANA `timezone`. Preserve requested timing, ask if timezone is unknown. Retries reuse the exact request ID and task details, even if later reads supply a different ID.

For multi-step updates, save source settings, supported access/identity, write/readback and retry instructions with the Site. Verify a fresh cloud task can retrieve the saved plan without the authoring checkout. Verify a new writer via its intended unattended access and read back the result, reusing an intended content write rather than adding test records. Routine data refreshes need not republish source.

`schedule.validate` checks an optional proposal for ownership, publication and duplicates. It never creates a task or verifies execution. In `schedule_suggestion`, provide `title`/`prompt`, with RRULE `schedule` only for user-specified timing. Pi has no native schedule-offer button: present a text proposal and wait for acceptance before creation. Validation alone is not an offer UI or saved automation.

Confirm timing and enabled/paused state only from successful task creation. That does not mean an update has run. If access or writer verification is unavailable, report the prerequisite without blocking ordinary Site handoff.
