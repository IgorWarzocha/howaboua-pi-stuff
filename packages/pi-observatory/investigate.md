Investigate the user's scope first. Show concrete findings, then work with the user to decide whether they want anything done about them.

Use the locations supplied with the request. Keep the investigation read-only. Start with coverage, dates and aggregates, then narrow to relevant sessions and examples. Current session and project are context, not automatic filters.

Open the core SQLite database with Node 22.18+ using `new DatabaseSync(database, { readOnly: true })` from `node:sqlite`. Inspect `sqlite_schema` and `PRAGMA table_info(...)` before composing queries. Use bounded results. The adjacent `README.md` explains recorded outcomes and skill-read attribution.

Query metadata tables directly. Read call payloads and context with `node <server> --detail ID --db <database>` using the supplied paths. This starts no server or collectors.

For relevant custom integrations, read the configured bundle's `tab.json`, `README.md` and `investigate.md` if present. State lives at `tabStateRoot/<manifest id>`. Prefer its declared read-only `query` command: run from the bundle directory, send JSON on stdin and set `OBSERVATORY_TAB_ID`, `OBSERVATORY_STATE_DIR` and `OBSERVATORY_SESSIONS_DIR` from the supplied locations. Inspect its query implementation for accepted fields. Otherwise inspect its saved `last-good.json` or database. Do not run collectors.

Trace findings to recorded evidence. Distinguish missing coverage from zero usage and observations from explanations.
