# PCC cache

A custom Observatory tab for Pi Codex Conversion's diagnostic logs. It shows cached input share, request hits and misses, daily mid-flight misses and their estimated rebill cost, retries, failures and transport history. It reads logs locally, without making model calls or changing PCC settings.

## Enable

Requires Node 22.18 or newer. Add this bundle's absolute directory to `tabs` in your Pi agent directory's `observatory/config.json`, preserving other settings:

```json
{
	"tabs": ["/absolute/path/to/pi-observatory/dist/tabs/pcc-cache"]
}
```

Restart the viewer and reload the browser. Select **PCC cache** in the navigation. Responses are selected by default. Compaction and All types are also available. The dashboard's session, project and date filters apply, alongside this tab's model and scope selectors. Scope appears only when there is a choice. Cache result filters only the request table.

Logs come from `pi-codex-logs` under `PI_CODING_AGENT_DIR`, or `~/.pi/agent` by default. PCC diagnostics must already be enabled to have data. To record future requests, use PCC's **Status + log** controls under `/codex openai`. This tab never enables logging for you and cannot reconstruct requests that were not logged.

For another log directory, copy the bundle to a directory you own and change its manifest command:

```json
"collector": ["node", "collect.js", "--logs", "/absolute/path/to/pi-codex-logs"]
```

## Read the evidence

- **Hit:** authoritative usage reports cached input tokens. **Miss:** positive input with zero cached tokens. Missing usage, zero input and non-authoritative prewarm are **Unmeasured**, not misses.
- **Cached input share** weights by tokens. **Request hit rate** weights each measured request equally. Reported input already includes cached tokens; they are not added twice.
- **Full/delta history** describes transport, not proof of a cache hit or its cause. Canonical history is reported separately. Fingerprints do not establish cache causality.
- Request IDs correlate usage, retries and fallbacks. A request that recovers is not counted as a final failure. Older logs without IDs remain uncorrelated observations; their usage still counts, but the model may be Unknown. They cannot provide deduplicated request-start counts.
- **Elapsed** is locally measured request time, where logged. Pending means no final outcome was recorded, not that a request is necessarily still running.

The two daily graphs track zero-cache misses after an observed cache hit. Initial cold requests are excluded, however many there are. A known model, prompt, tools, routing, compaction or process change resets the baseline, as does input shorter than the previously cached prefix. Consecutive misses retain that prefix until another hit or reset. Classification uses the complete log sequence before date filters, so narrowing the view does not turn a mid-flight miss into a startup miss. Partial hits remain hits.

Rebill cost estimates the extra charge for reprocessing the previously cached prefix at the normal input rate instead of the cached rate. Fresh input and output tokens are excluded. Prices follow the [official table](https://developers.openai.com/api/docs/pricing), verified on 20 October 2026, with the recorded service tier and long-context multiplier. The graphs report missing context metadata and unpriced misses separately. Raw miss totals and the request table still include startup and unclassified misses.

Totals, daily activity and request pages query the complete indexed history with the same session, project, date, model, type and scope filters. The table shows 50 records per page; every matching record remains accessible. Selecting Miss shows the requests counted by the miss total, not a sample of recent requests. Missing or incomplete source logs remain coverage gaps.

## Collection

Starting the viewer or opening it with `/observatory` requests one update, then pauses. Each update runs a bounded collection pass. Live monitoring repeats it with a ten-second pause between runs. The collector keeps a private SQLite index and incremental cursors under `OBSERVATORY_STATE_DIR`. It does not read or modify Observatory's core database or session files. Complete lines and their cursor updates commit together. Incomplete final lines wait for an append. Replaced or rewritten logs start a separate generation without deleting earlier indexed records. Existing history also remains available while bounded replay adds rebill metadata. The dashboard shows pending work. Another update or live monitoring continues it.

Only immediate regular `.log` files are read; symlinks are not followed. The collector publishes compact coverage metadata. A separate read-only query command serves aggregates and request pages from that index without rereading logs. Results contain allowlisted metadata, not raw log lines, prompts or responses. Session names and project paths remain visible, so use the same access precautions as for the rest of Observatory. See [Custom tabs](../../docs/custom-tabs.md) for the trust boundary and collector contract.
