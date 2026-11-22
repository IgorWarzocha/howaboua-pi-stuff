# Recurring updates

A schedule needs an active, published Site owned by the user, independently verified source access and an authenticated writer usable while the page is closed. Browser polling/WebMCP is not an unattended updater. D1, an MCP URL or a service credential alone proves neither source consent nor writer access. Use `mcp` when Site-hosted tools are needed. This facade redacts service credentials and does not supply an unattended writer.

Read fresh `site.get` metadata and linked `automations` first. If automations are absent or null, you MUST NOT create or suggest schedules. An empty list means none are linked; still verify the updater. Reuse a matching automation and preserve paused state. Use supported task controls for edits without losing the Site link. Pi's Sites tools cannot edit an existing task or show an interactive offer card.

`schedule.create` is for requested or accepted recurring work. Copy `schedule_request_id` to `request_id` unchanged. Supply `task` with `title`, a self-contained credential-free `prompt`, iCal `VEVENT` `schedule` and IANA `timezone`. Preserve requested timing, ask if timezone is unknown. Retries reuse the exact request ID and task details, even if later reads supply a different ID.

For multi-step updates, save source settings, supported access/identity, write/readback and retry instructions with the Site. Verify a fresh cloud task can retrieve the saved plan without the authoring checkout. Verify a new writer via its intended unattended access and read back the result, reusing an intended content write rather than adding test records. Routine data refreshes need not republish source.

`schedule.validate` only checks ownership, publication and duplicates. For `schedule_suggestion`, give `title` and `prompt`; include RRULE `schedule` only for user-specified timing. Present proposals in text and wait for acceptance before creation.

Confirm timing and enabled/paused state only from successful task creation. That does not mean an update has run. If access or writer verification is unavailable, report the prerequisite without blocking ordinary Site handoff.
