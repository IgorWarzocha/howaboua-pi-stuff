# Custom tabs

A tab is a local bundle: a manifest, a collector and a web page. The collector produces JSON; the page decides how to display it. Neither needs to import Observatory internals or change its SQLite schema.

**Enable only code you trust.** Collectors run with your account's permissions and environment. Pages share the dashboard's origin and can access its data. The iframe separates presentation, not privileges. This first version runs collectors on Linux and macOS. Windows reports custom tabs as unavailable; built-in views remain usable.

## Try the example

For a ready-to-use log dashboard, see [PCC cache](../tabs/pcc-cache/README.md). It uses this same bundle contract and keeps its own incremental index, separate from core session indexing.

The `dist/examples/machine` bundle in the installed package reports real host memory, CPU count, uptime and load. Add its absolute directory to the existing `observatory/config.json` under your Pi agent directory:

```json
{
  "tabs": ["/absolute/path/to/pi-observatory/dist/examples/machine"]
}
```

Keep any other settings in that file. Restart the viewer and reload the browser. The Machine tab appears in the navigation. Remove a path from `tabs` and restart to disable that bundle. Nothing is enabled merely by existing on disk.

Copy the example to a directory you own before changing it. Bundles can live outside the repository. The configured paths must be absolute.

## Bundle layout

```text
my-tab/
  tab.json
  collect.mjs
  web/
    index.html
    view.js
    style.css
```

```json
{
  "apiVersion": 1,
  "id": "my-tab",
  "title": "My tab",
  "entry": "index.html",
  "collector": ["node", "collect.mjs"],
  "intervalSeconds": 60,
  "timeoutSeconds": 30,
  "filters": []
}
```

`id` is a unique lowercase slug, beginning with a letter, up to 64 characters. `title` is up to 80 characters. `entry` defaults to `index.html` and is relative to `web/`. Only files inside that directory are served; keep private files and collector code outside it. Assets are limited to 16 MiB each. Use separate script and stylesheet files, served from the bundle, rather than inline code or CDN dependencies.

The command is an argument array, not a shell expression. Python and other executables work too. Its working directory is the bundle directory. Refresh defaults to 60 seconds and can be set from 5 to 86,400 seconds. Timeout defaults to 30 seconds and can be set from 1 to 300 seconds. Invalid bundles and duplicate IDs are reported without preventing built-in views from starting.

## Agent investigations

`/observatory agent <scope>` gives the agent your configured bundle paths. For relevant tabs, the bundled guide directs it to read `tab.json`, `README.md` and an optional `investigate.md` beside them. No extra JSON field is needed.

Keep `investigate.md` brief: explain where saved data lives, accepted query inputs and useful interpretations. The agent investigates first, then discusses findings and possible changes with the user. The command does not start collectors.

## Collector contract

Write one complete JSON value to stdout and exit successfully. Write diagnostic logs to stderr. Starting the viewer or opening it with `/observatory` requests one update, then pauses. Update once runs each collector once. Live monitoring runs it immediately, then waits `intervalSeconds` after each completed run before starting another. Runs never overlap. Browsing pages or changing filters never triggers collection. A bounded collector may need more than one update to finish historical work. Expose that progress in its snapshot.

The collector receives:

| Environment variable | Meaning |
| --- | --- |
| `OBSERVATORY_TAB_ID` | The manifest ID |
| `OBSERVATORY_STATE_DIR` | A private writable directory for cursors and history |
| `OBSERVATORY_SESSIONS_DIR` | The configured Pi session directory, to read if needed |

Treat source sessions as read-only. Keep your own incremental cursors or database under the state directory. Observatory reserves `last-good.json` and `last-good.*.tmp` there for snapshot storage. Do not depend on the core index's schema or modify it. Emit the data the page needs rather than raw session archives.

Stdout is limited to 4 MiB and stderr to 64 KiB per run. Invalid JSON, excess output, a nonzero exit or a timeout fails that run. The previous successful snapshot remains available with its original update time and a visible error. Successful snapshots survive viewer restarts. Unchanged JSON is not republished: `updatedAt` is the last data change, while `lastStartedAt` records collection attempts. Include a data revision when indexed query results change without changing the snapshot's other fields. Run collectors in the foreground; do not start detached daemons. Observatory terminates the collector process group on pause, timeout and shutdown.

## Page contract

Import the host's small client bridge:

```js
import { connectTab } from "/tab-client.js";

const disconnect = connectTab(({ data, status, filters }) => {
  // Render your collector's data, applying any declared filters.
});
```

The callback runs when the page connects, collection status or data refreshes, or applied dashboard filters change. `data` is your JSON value. It is `null` before the first successful run; `status.updatedAt` distinguishes that state from a collector that deliberately emits JSON null.

`status` contains `running`, `lastStartedAt`, `updatedAt` and `error`. Timestamps are ISO strings or null; `error` is a message or null. The host already displays collection age and errors above the page. Validate your own snapshot shape before rendering it. `disconnect()` removes the message listener if your page needs to unmount it.

Pages are mounted only while their tab is visible. Switching tabs removes the iframe but does not stop collection. Keep durable state in the collector's state directory rather than relying on an iframe staying alive.

Link `/base.css` and `/theme.css` before your own stylesheet to use the dashboard's typography, controls and colour variables. The example shows this setup. Use relative URLs for your own assets. They are served under `/tabs/<id>/`.

The client bridge sizes the frame to the page's content, including later updates, so the dashboard scrolls as one page. Use normal document flow and content-driven heights; viewport-relative heights such as `100vh` refer to the frame itself and can create a resizing loop.

## Dashboard filters

Declare only the filters your page actually implements: `session`, `project`, `since` and `until`. For example:

```json
{ "filters": ["project", "since", "until"] }
```

The bridge supplies these keys as strings, with an empty string for an inactive filter. Dates are inclusive UTC calendar days. Apply them to the snapshot in your page, or pass them to your bundle's query command. The collector always runs independently of the browser. The host reports active dashboard filters that the tab does not support. Call-only filters do not apply to custom tabs.

## Queries

For history too large for a snapshot, keep an index in the collector's state directory and add an optional command to `tab.json`:

```json
"query": ["node", "query.ts"]
```

The command receives one JSON value on stdin and returns one JSON value on stdout. It uses the same working directory and environment as the collector. Queries must read only the bundle's own index; they must not collect data, read source logs or access Observatory's core SQLite schema.

Call it from the page through the client bridge:

```js
import { queryTab } from "/tab-client.js";

const page = await queryTab({ ...filters, offset: 0 }, controller.signal);
```

The request and result schemas belong to the bundle. Implement filters and pagination against the full index rather than truncating history to fit a snapshot. Bound each response, not the records a user can reach.

Each query has a ten-second timeout, a 16 KiB input limit, a 4 MiB stdout limit and a 64 KiB stderr limit. Up to four queries can run per tab; additional requests receive a busy error. Cancellation and viewer shutdown stop the query's process group. Failed queries return errors rather than partial results. Starting a query never starts collection.
