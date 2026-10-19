# Pi Observatory

Explore tool failures in your current Pi session, switch to all sessions or search for another session. Filter by model, provider, tool, project and date, then inspect the recorded arguments, result and neighbouring messages. Counts include successful calls so you can compare failure rates rather than just failure totals.

Indexing runs in a background worker. The dashboard reads SQLite exclusively, including call details and conversation excerpts. New entries appear without rescanning indexed JSONL content. Call pages stay put while you inspect them, with a notice when fresh data is available.

## Run

This first pass is source-only and is not published to npm. It requires Node 22.18 or newer and the repository's dependencies.

From the repository root:

```sh
bun install --frozen-lockfile
pi install ./packages/pi-observatory
```

Start a new Pi session or reload extensions, then run `/observatory`. Like `/board`, it starts or reuses a background viewer, opens your browser and prints a link. It opens on the current session. Use **All sessions** to broaden the view, or search the session selector by project or session ID. If the browser cannot open, use the printed link.

All Pi sessions share one server and one index per agent directory. Opening another tab changes only its view, not the background work. The server keeps indexing after Pi closes. No agent tool or prompt instructions are added.

For a standalone server instead:

```sh
bun run --cwd packages/pi-observatory start
```

The standalone URL starts on all sessions because it has no current Pi session. Stop this foreground server with Ctrl+C. Starting it again resumes the saved indexing cursors.

Defaults are `~/.pi/agent/sessions`, `~/.pi/agent/observatory/index.sqlite` and port `47985`. `PI_CODING_AGENT_DIR` replaces `~/.pi/agent` when set. To select other locations:

```sh
bun run --cwd packages/pi-observatory start --sessions /path/to/sessions --db /path/to/index.sqlite --port 47985
```

The server binds to `127.0.0.1` by default. To view it from another computer, forward its port with SSH and open the printed URL on that computer:

```sh
ssh -N -L 47985:127.0.0.1:47985 user@host
```

**Session text can contain secrets.** The SQLite index stores arguments, outputs and message excerpts locally without secret redaction. Keep it private. The dashboard requires a launch-specific access token and does not upload data or make model calls.

## Viewer configuration

Optional settings live in `~/.pi/agent/observatory/config.json`. As with the board viewer, `openCommand: null` makes the command link-only. A custom opener is an argument array, with the viewer URL appended. The server must restart after configuration changes.

```json
{ "openCommand": null, "port": 47985 }
```

For direct access on a trusted network, set `host` to `0.0.0.0` and `publicUrl` to the externally reachable HTTP or HTTPS origin. A reverse proxy must provide HTTPS if desired. Plain HTTP exposes session data and the viewer token to that network; prefer SSH forwarding or HTTPS. `sessions` and `database` can select other absolute paths. The browser cannot change these paths.

The background server writes `observatory/server.log`. Its PID is in `observatory/server.lock`. Stop that PID with `kill -TERM PID`, then run `/observatory` again to restart it. Do not delete a lock while its process is alive. Changing the database or port does not start a second server in the same agent directory.

## Read the evidence

- **Error** means an explicit error marker, failed nested trace or recorded script error.
- **Nonzero exit** means a recorded nonzero subprocess result without an explicit error marker. A search with no matches can legitimately produce one.
- **Cancelled** and **blocked** require explicit recorded statuses. Ambiguous results remain **unknown**. Calls without a recorded outcome remain **pending**, even after their session ends.
- Direct calls and observed nested calls have separate scopes. “All calls” includes wrappers and their children, not independent attempts. Rates include pending and unknown calls in their denominators.

Model attribution comes from the initiating assistant message, including the originating cell for known nested continuations. Dates and ordering use the initiating call time where known, not measured completion time. Backend model snapshots and extension versions are not inferred from current installations. Missing attribution stays unknown.

Identical copied history is deduplicated across forked sessions. A session view includes calls in its copied history, with their latest indexed outcomes. Repeated nested snapshots update the same call instead of adding calls. Neighbouring messages show file chronology, not proof of recovery or necessarily the active branch.

Search matches word prefixes in tool names and failure signatures. It does not search full arguments or outputs. Breakdowns show the top 100 models and tools, the top 30 signatures and the latest 90 recorded days. Date filters use UTC, with the Until date included.

## Index coverage

The indexer checks file metadata every two seconds and consumes appended bytes. During backfill it yields between file batches to discover new sessions and active tails. Complete lines and their cursor commit together. A partially written final line is saved until its remaining bytes arrive. After a crash, only uncommitted work may be read again.

Coverage reports malformed lines, unmatched results, wrappers without saved traces and reported trace drops. A wrapper without traces might not have called a tool at all. Drop counts are reported snapshots and can overlap across continuations. None of these counters proves complete nested visibility.

Binary attachments are omitted from indexed details. Strings are capped at 131,072 characters, details at 524,288 characters and neighbouring message excerpts at 32,768 characters. JSONL lines over 32 MiB are skipped and reported. Existing source-side truncation cannot be recovered.

Source files are never modified. If a file is replaced, shortened or detectably rewritten behind its cursor, indexing that file stops and the dashboard reports it. Existing indexed history remains available. Choose a fresh `--db` path to rebuild from the current files. Append-only histories are the supported incremental path. Symlinked files and subdirectories are not followed.
