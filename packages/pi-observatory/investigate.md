Investigate the user's scope and report concrete findings before discussing any changes with them. The investigation MUST be read-only; never start the server or collectors.

Use the supplied locations. Start with coverage, dates and aggregates, then narrow to relevant sessions and examples. Filter by session or project only when the scope calls for it.

Open the core SQLite database with Node 22.18+ using `new DatabaseSync(database, { readOnly: true })` from `node:sqlite`. Inspect `sqlite_schema` and `PRAGMA table_info(...)` before composing queries. Use bounded results. The adjacent `README.md` explains recorded outcomes and skill-read attribution.

Query metadata tables directly. Read call payloads and context with `node <server> --detail ID --db <database>` using the supplied paths.

For relevant custom integrations, read the bundle's `tab.json` and any `README.md` or `investigate.md`. State lives at `tabStateRoot/<manifest id>`. Prefer its declared read-only `query` command: run from the bundle directory, send JSON on stdin and set `OBSERVATORY_TAB_ID`, `OBSERVATORY_STATE_DIR` and `OBSERVATORY_SESSIONS_DIR` from the supplied locations. Inspect its query implementation for accepted fields. Otherwise read its saved `last-good.json` or database.

Trace findings to recorded evidence. Distinguish missing coverage from zero usage and observations from explanations.
