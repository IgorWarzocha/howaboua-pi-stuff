# Pi Observatory

See which tools your agents call, how often and with which models. Usage bars rank tools and models by call volume, with exact counts and shares. Select a bar to inspect its calls, arguments and results. The activity graph shows daily errors, nonzero exits, missing final results and unclassified results. Its interactive counts include total and successful calls.

Switch views and filter from the site header. Start with the current session, switch to all sessions or search for another session. Expand the tables for more tools and error counts. Errors, nonzero exits and index diagnostics remain available below the charts. Filter by model, provider, tool, project and date. Drill-downs and individual call details open at the top of their view. Back restores the previous filters, call page and scroll position.

Commands and Skills each use one ranked table with search, sorting and pagination. Commands shows only recorded slash submissions, alongside the recording start time and session coverage. It cannot reconstruct historical command usage or identify unused commands. Loaded inventory alone never creates a command usage row. Skills ranks agent reads, with user skill submissions counted separately. Loaded-resource snapshots show historical availability, not use or current installation. These views use the session, project and date filters.

Indexing runs in a background worker. The dashboard reads SQLite exclusively, including call details and conversation excerpts. New entries appear without rescanning indexed JSONL content. Overview and usage views update automatically. Call pages stay put while you inspect them. A refresh icon appears beside Outcome when fresh data is available. Select it to load the newest matching calls.

## Run

This first pass is source-only and is not published to npm. It requires Node 22.18 or newer and the repository's dependencies.

From the repository root:

```sh
bun install --frozen-lockfile
pi install ./packages/pi-observatory
```

Start a new Pi session or reload extensions, then run `/observatory`. Like `/board`, it starts or reuses a background viewer, opens your browser and prints a link. It opens on the current session. Use **All sessions** to broaden the view, or search the session selector by project or session ID. If the browser cannot open, use the printed link.

All Pi sessions share one server and one index per agent directory. Opening another tab changes only its view, not the background work. The server keeps indexing after Pi closes. No agent tool or prompt instructions are added.

Each `/observatory` opening applies that Pi session's theme to the shared viewer, including custom colours. After changing Pi's theme, run `/observatory` again. Reload other open tabs to pick up the colours. The last applied theme survives server restarts. A standalone viewer uses the browser's light or dark preference until first opened from Pi.

With the extension loaded, Observatory records submitted extension commands, skills and prompt templates through Pi's editor. Standard Pi controls such as `/new` and `/quit`, and unknown slash names, are excluded. It stores command names without arguments. Editor submissions made by automation count too. RPC and non-interactive input are not recorded by this hook.

Command observations and loaded-resource inventories are stored in `observatory/events`, separately from Pi's session files. Recording starts when the editor observer attaches. Earlier command usage cannot be recovered from ordinary session history.

Skill tracking does not require Better Skills. Observatory recognises ordinary file-reader inputs and literal shell reads within known `.pi/skills`, `.pi/agent/skills` and `.agents/skills` locations. Custom and package locations require recorded loaded-skill inventory or structured receipts. An arbitrary project's `SKILL.md` does not qualify. Files read under an identified `SKILL.md` directory count as references. Flat Markdown skills match only their own file. Relative paths use the recorded working directory, never the viewer's directory. These are inferred reads, shown separately from confirmed structured receipts. A request identifies intended access, not proof that every byte reached the agent.

Historical reads are recovered from cached calls and recognisable Skills tool outputs in the background. Output inventories are not themselves reads. The Skills view labels counts and rankings as partial until both history scans finish. Dynamic scripts, unresolved paths, hidden file access and missing arguments cannot be reliably attributed. Path mentions, listings and searches are not counted as skill reads. An empty count means no recorded use, not proof that a capability was never used. User skill commands never count as agent reads, and disabling those commands does not establish whether agents can access skills.

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

**Session text can contain secrets.** The SQLite index stores arguments, outputs and message excerpts locally without secret redaction. The viewer has no authentication. Anyone who can reach it can read that data. It does not upload data or make model calls.

## Viewer configuration

Optional settings live in `~/.pi/agent/observatory/config.json`. As with the board viewer, `openCommand: null` makes the command link-only. A custom opener is an argument array, with the viewer URL appended. The server must restart after configuration changes.

```json
{ "openCommand": null, "port": 47985 }
```

For direct access on a trusted network, set `host` to `0.0.0.0` and `publicUrl` to the externally reachable HTTP or HTTPS origin. A reverse proxy must provide HTTPS if desired. Plain HTTP exposes session data to that network. Use SSH forwarding or a protected reverse proxy outside a trusted network. `sessions` and `database` can select other absolute paths. The browser cannot change these paths.

The background server writes `observatory/server.log`. Its PID is in `observatory/server.lock`. Stop that PID with `kill -TERM PID`, then run `/observatory` again to restart it. Do not delete a lock while its process is alive. Changing the database or port does not start a second server in the same agent directory.

## Read the evidence

- **Error** means an explicit error marker, failed nested trace or recorded script error.
- **Nonzero exit** means a recorded nonzero subprocess result without an explicit error marker. A search with no matches can legitimately produce one.
- **No final result** means the index has a call without a matched result, or only a partial nested trace. It does not mean the call is still running. **Unclassified result** means the retained evidence does not establish an outcome.
- Error rates use completed results: OK, error and nonzero exit. Missing and unclassified results are excluded.

Direct calls and observed nested calls have separate scopes. All calls includes wrappers and their children, which can report the same failure. Counts describe recorded observations, not independent attempts. Aborted calls recorded as errors remain errors. A tool successfully reporting another agent's status is not itself a failed or blocked execution.

Native Pi nested-call records provide names, arguments when retained, and outcomes, but no result content. Matching Code and Notebook traces are counted once using their recorded Pi call identities. Older mixed records without those identities remain explicit coverage gaps rather than guessed matches.

Model attribution comes from the initiating assistant message, including the originating cell for known nested continuations. Dates and ordering use the initiating call time where known, not measured completion time. Backend model snapshots and extension versions are not inferred from current installations. Missing attribution stays unknown.

Identical copied history is deduplicated across forked sessions. A session view includes calls in its copied history, with their latest indexed outcomes. Repeated nested snapshots update the same call instead of adding calls. Neighbouring messages show file chronology, not proof of recovery or necessarily the active branch.

Search matches word prefixes in tool names and error messages. It does not search full arguments or outputs. Selecting an error message filters its exact stored pattern, tool and model. Use **Clear pattern** to remove that pattern filter.

Charts show the top six tools and models. Their tables include up to 100 of each. Error and exit tables each show up to 30 patterns. Activity covers up to 90 calendar days ending on the latest indexed day in the selection. Gaps between recorded days show zero indexed calls. The four plotted outcomes share a count scale. Total and OK counts remain available below the graph for each selected day. Hover a day to preview its exact totals, each outcome and error rate. Click or use arrow keys to select the day, then select a count to inspect its matching calls. Date filters use UTC, with the Until date included.

## Index coverage

The indexer checks file metadata every two seconds and consumes appended bytes. During backfill it yields between file batches to discover new sessions and active tails. Complete lines and their cursor commit together. A partially written final line is saved until its remaining bytes arrive. After a crash, only uncommitted work may be read again.

Index diagnostics, below the Overview charts, reports malformed lines, unmatched results, wrappers without saved traces and reported trace drops. A wrapper without traces might not have called a tool at all. Drop counts are reported snapshots and can overlap across continuations. None of these counters proves complete nested visibility.

Existing indexes are updated from cached SQLite evidence when the server starts. Native nested-call and skill-file scans run in bounded background batches. These updates preserve indexing cursors and do not reread session files.

Binary attachments are omitted from indexed details. Strings are capped at 131,072 characters, details at 524,288 characters and neighbouring message excerpts at 32,768 characters. JSONL lines over 32 MiB are skipped and reported. Existing source-side truncation cannot be recovered.

Source files are never modified. If a file is replaced, shortened or detectably rewritten behind its cursor, indexing that file stops and the dashboard reports it. Existing indexed history remains available. Choose a fresh `--db` path to rebuild from the current files. Append-only histories are the supported incremental path. Symlinked files and subdirectories are not followed.
