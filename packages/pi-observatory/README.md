# Pi Observatory

See which tools your agents call, how often and with which models. Usage bars rank tools and models by call volume, with exact counts and shares. Select a bar to inspect its calls, arguments and results. The activity graph shows daily errors, nonzero exits, missing final results and unclassified results. Its interactive counts include total and successful calls.

Switch views and filter from the site header. Start with the current session, switch to all sessions or search for another session. Expand the tables for more tools and error counts. Errors, nonzero exits and index diagnostics remain available below the charts. Filter by model, provider, tool, project and date. Drill-downs and individual call details open at the top of their view. Back restores the previous filters, call page and scroll position.

Commands and Skills each use one ranked table with search, sorting and pagination. Commands shows only recorded slash submissions, alongside the recording start time and session coverage. It cannot reconstruct historical command usage or identify unused commands. Loaded inventory alone never creates a command usage row. Skills ranks agent reads, with user skill submissions counted separately. Source shows each resource's package or file. These views use the session, project and date filters.

Their activity graphs show daily usage before table pagination. Commands plots User submissions. Skills starts with the three most-read active skills, with a separate line for each. Tick up to six skills in the table to compare them. The Agent/User toggle switches between agent reads and user submissions. Selections persist across table pages. Hover or use the arrow keys for daily counts, then select a count to filter the table to that day. Browser Back restores the previous date range. Each graph covers up to 90 calendar days ending on the latest recorded activity in its selection. The same resource search and filters apply to the graph and table.

Starting the viewer or opening it with `/observatory` updates the saved index and runs each custom collector once, then pauses. Browsing views does not start more collection. Click the pause icon beside the title for another update. The icon shows sync while that work runs, then returns to pause. Hold the button for two seconds to enable live monitoring; click it again to pause. Keyboard users can hold Space. Pause uses your theme's warning colour; live uses its success colour.

Indexing runs in a background worker. Lists, filters and charts read SQLite metadata. Call details and conversation excerpts read the relevant records from the original JSONL files, without scanning whole sessions or keeping another payload copy in SQLite. During collection, the visible overview or usage view updates automatically; hidden views load when opened. Call pages stay put while you inspect them. A refresh icon appears beside Outcome when fresh data is available. Select it to load the newest matching calls.

Add your own tabs with a local collector and a custom web page. Observatory runs collection in the background, stores the latest successful JSON snapshot and hosts the page alongside its built-in views. See [Custom tabs](https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/main/packages/pi-observatory/docs/custom-tabs.md) for the bundle contract and a working machine-health example.

The [PCC cache tab](https://github.com/IgorWarzocha/howaboua-pi-stuff/blob/main/packages/pi-observatory/tabs/pcc-cache/README.md) reads Pi Codex Conversion's diagnostic logs to show cache hits, token reuse, retries and transport history. Enable it separately; it does not change PCC's logging settings. Installed bundles are under the package's `dist/tabs` and `dist/examples` directories. The guides are also included under `dist/docs` and beside each bundle.

## Run

Requires Node 22.18 or newer and Pi 1.3 or newer. Install separately; Observatory is not included in the aggregate bundles.

```sh
pi install npm:@howaboua/pi-observatory
```

Start a new Pi session or reload extensions, then run `/observatory`. Like `/board`, it starts or reuses a background viewer, opens your browser and prints a link. It opens on the current session. Use **All sessions** to broaden the view, or search the session selector by project or session ID. If the browser cannot open, use the printed link.

All Pi sessions share one server, one index and one collection mode per agent directory. Reopening with `/observatory` requests a catch-up without restarting an active update or changing an existing live mode. Live monitoring continues after Pi closes until you pause it or stop the server. Restarting the server catches up once, then pauses. No standing agent tools or prompt instructions are added.

Use `/observatory agent <scope>` to investigate something you notice:

```text
/observatory agent I've noticed lots of cache misses today. Which sessions, and can we trace why?
```

This sends your question to the current agent with the bundled investigation guide and your configured data locations. The agent investigates first, then discusses findings and next steps with you. It does not open the browser or start collection. Include the relevant dates or filters in your question; browser selections are not sent automatically.

Each `/observatory` opening applies that Pi session's theme to the shared viewer, including custom colours. After changing Pi's theme, run `/observatory` again. Reload other open tabs to pick up the colours. The last applied theme survives server restarts. A standalone viewer uses the browser's light or dark preference until first opened from Pi.

With the extension loaded, Observatory records submitted extension commands, skills and prompt templates through Pi's editor. Standard Pi controls such as `/new` and `/quit`, and unknown slash names, are excluded. It stores command names without arguments. Editor submissions made by automation count too. RPC and non-interactive input are not recorded by this hook.

Command observations and loaded-resource inventories are stored in `observatory/events`, separately from Pi's session files. Command recording starts when the editor observer attaches. Earlier command usage cannot be recovered from ordinary session history.

While the extension is loaded, public Pi tool events also record tool source metadata and bounded nested arguments and results in those sidecars. Call details show the captured evidence. This works with ordinary tools and native Code Mode as well as PCC. Pausing the viewer stops collection, not event recording in Pi.

Skill tracking does not require Better Skills. Observatory recognises ordinary file-reader inputs and literal shell reads within known `.pi/skills`, `.pi/agent/skills` and `.agents/skills` locations. Custom and package locations require recorded loaded-skill inventory or structured receipts. An arbitrary project's `SKILL.md` does not qualify. Files read under an identified `SKILL.md` directory count as references. Flat Markdown skills match only their own file. Relative paths use the recorded working directory, never the viewer's directory. These are inferred reads, shown separately from confirmed structured receipts. A request identifies intended access, not proof that every byte reached the agent.

Historical reads are recovered from recorded calls and recognisable Skills tool outputs in the background. Output inventories are not themselves reads. The Skills view labels counts and rankings as partial until both history scans finish. Dynamic scripts, unresolved paths, hidden file access and missing arguments cannot be reliably attributed. Path mentions, listings and searches are not counted as skill reads. An empty count means no recorded use, not proof that a capability was never used. User skill commands never count as agent reads, and disabling those commands does not establish whether agents can access skills.

For a standalone server instead:

```sh
npx @howaboua/pi-observatory
```

The standalone URL starts on all sessions because it has no current Pi session. Stop this foreground server with Ctrl+C. Starting it again resumes the saved indexing cursors.

Defaults are `~/.pi/agent/sessions`, `~/.pi/agent/observatory/index.sqlite` and port `47985`. `PI_CODING_AGENT_DIR` replaces `~/.pi/agent` when set. To select other locations:

```sh
npx @howaboua/pi-observatory --sessions /path/to/sessions --db /path/to/index.sqlite --port 47985
```

To inspect one indexed call without starting the server or collectors, run `pi-observatory --detail ID`. Add `--db FILE` for a different index. It prints the call details and surrounding conversation as JSON.

The server binds to `127.0.0.1` by default. To view it from another computer, forward its port with SSH and open the printed URL on that computer:

```sh
ssh -N -L 47985:127.0.0.1:47985 user@host
```

**Session text can contain secrets.** The index stores metadata and previews without secret redaction. The viewer reads arguments, outputs and conversation excerpts from local source files on demand. It has no authentication. Anyone who can reach it can read that data. It does not upload data or make model calls.

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

Timestamps use your browser's local timezone and date format, with the timezone shown. Daily graphs and date filters use UTC calendar days so their selections match the indexed counts.

Direct tools, nested tools and native Code Mode model operations have separate scopes. The default view includes all three, with `models.classify` and `models.generateImages` labelled as model operations rather than tools. Pi records their target model, status, duration and reported cost, but not their inputs or outputs. All calls includes wrappers and their children, which can report the same failure. Counts describe recorded observations, not independent attempts. Aborted calls recorded as errors remain errors. A tool successfully reporting another agent's status is not itself a failed or blocked execution.

Native Pi session receipts provide nested names, arguments when retained, and outcomes, but no result content. Observatory's live observations enrich those receipts when available. Matching Code and Notebook traces are counted once using their recorded Pi call identities; their associated live results remain available in call details. Earlier sessions without live observations retain explicit result gaps. Unmatched observations stay visible in index diagnostics rather than being guessed into another call.

Model attribution comes from the initiating assistant message, including the originating cell for known nested continuations. Dates and ordering use the initiating call time where known, not measured completion time. Backend model snapshots and extension versions are not inferred from current installations. Missing attribution stays unknown.

Identical copied history is deduplicated across forked sessions. Historical calls and relative skill paths retain their original project, even when the fork runs elsewhere. Missing ancestry leaves the project unknown. A session view includes calls in its copied history, with their latest indexed outcomes. Repeated nested snapshots update the same call instead of adding calls. Neighbouring messages show file chronology, not proof of recovery or necessarily the active branch.

Search matches word prefixes in tool names and error messages. It does not search full arguments or outputs. Selecting an error message filters its exact stored pattern, tool and model. Use **Clear pattern** to remove that pattern filter.

Charts show the top six tools and models. Their tables include up to 100 of each. Error and exit tables each show up to 30 patterns. Activity covers up to 90 calendar days ending on the latest indexed day in the selection. Gaps between recorded days show zero indexed calls. The four plotted outcomes share a count scale. Total and OK counts remain available below the graph for each selected day. Hover a day to preview its exact totals, each outcome and error rate. Click or use arrow keys to select the day, then select a count to inspect its matching calls. Date filters use UTC, with the Until date included.

## Index coverage

During live monitoring, the indexer checks file metadata every two seconds and consumes appended bytes. Unchanged scans do not write to the index. During backfill it yields between file batches to discover new sessions and active tails. Complete lines and their cursor commit together. A partially written final line is saved until its remaining bytes arrive. After a crash, only uncommitted work may be read again.

Index diagnostics, below the Overview charts, reports malformed lines, unmatched results, wrappers without saved traces and reported trace drops. A wrapper without traces might not have called a tool at all. Drop counts are reported snapshots and can overlap across continuations. None of these counters proves complete nested visibility.

Indexes created before source-backed storage rebuild automatically once when the updated server starts. Only the derived core index is replaced. Source files and custom-tab databases are not deleted. Later starts resume the saved indexing cursors, including after an interrupted rebuild. If an older server is still running, stop it and reopen Observatory to start the updated version.

Historical skill scans run in bounded background batches. These updates preserve indexing cursors and read only the source records they need.

Binary attachments are omitted from indexed details. Strings are capped at 131,072 characters, details at 524,288 characters and neighbouring message excerpts at 32,768 characters. Live arguments and results are each capped at 128 KiB, with truncation marked. JSONL lines over 32 MiB are skipped and reported. Existing source-side truncation cannot be recovered.

The built-in indexer never modifies source files. If a file is replaced, shortened or detectably rewritten behind its cursor, indexing that file stops and the dashboard reports it. Indexed statistics remain available, but details whose source is missing or changed are reported as unavailable. Stop the server and use `--rebuild` to index the current files afresh. Append-only histories are the supported incremental path. Symlinked files and subdirectories are not followed.
