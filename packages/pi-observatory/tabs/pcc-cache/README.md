# PCC cache

A custom Observatory tab for Pi Codex Conversion's diagnostic logs. It shows cached input share, request hits and misses, daily token volume, retries, failures and transport history. It reads logs locally, without making model calls or changing PCC settings.

## Enable

Requires Node 22.18 or newer. Add this bundle's absolute directory to `tabs` in your Pi agent directory's `observatory/config.json`, preserving other settings:

```json
{
  "tabs": ["/absolute/path/to/pi-observatory/tabs/pcc-cache"]
}
```

Restart the viewer and reload the browser. Select **PCC cache** in the navigation. Responses are selected by default; Compaction and Prewarm are separate request types. The dashboard's session, project and date filters apply, alongside this tab's model and scope selectors. Cache result filters only the recent-details table.

Logs come from `pi-codex-logs` under `PI_CODING_AGENT_DIR`, or `~/.pi/agent` by default. PCC diagnostics must already be enabled to have data. To record future requests, use PCC's **Status + log** controls under `/codex openai`. This tab never enables logging for you and cannot reconstruct requests that were not logged.

For another log directory, copy the bundle to a directory you own and change its manifest command:

```json
"collector": ["node", "collect.ts", "--logs", "/absolute/path/to/pi-codex-logs"]
```

## Read the evidence

- **Hit:** authoritative usage reports cached input tokens. **Miss:** positive input with zero cached tokens. Missing usage, zero input and non-authoritative prewarm are **Unknown**, not misses.
- **Cached input share** weights by tokens. **Request hit rate** weights each measured request equally. Reported input already includes cached tokens; they are not added twice.
- **Full/delta history** describes transport, not proof of a cache hit or its cause. Canonical history is reported separately. Fingerprints do not establish cache causality.
- Request IDs correlate usage, retries and fallbacks. A request that recovers is not counted as a final failure. Older logs without IDs remain uncorrelated observations; their usage still counts, but the model may be Unknown. They cannot provide deduplicated request-start counts.
- **Elapsed** is locally measured request time, where logged. Pending means no final outcome was recorded, not that a request is necessarily still running.

The view retains aggregate buckets for up to 90 UTC days ending on the latest logged day, and at most 1,500 recent detail records. Very large snapshots drop older whole days to stay within the tab's payload budget. Coverage notices identify omitted history, ongoing backfill, incomplete tails and source errors. Filtering can find aggregate usage whose individual details are no longer in the recent-record window.

## Collection

Collection runs independently of the browser, with a ten-second pause between runs. The collector keeps a private SQLite index and incremental cursors under `OBSERVATORY_STATE_DIR`. It does not read or modify Observatory's core database or session files. Complete lines and their cursor updates commit together; incomplete final lines wait for an append. Replaced or shortened files are reported rather than silently mixed with their earlier contents.

Only immediate regular `.log` files are read; symlinks are not followed. Snapshots contain allowlisted metadata, not raw log lines, prompts or responses. Session names and project paths remain visible, so use the same access precautions as for the rest of Observatory. See [Custom tabs](../../docs/custom-tabs.md) for the trust boundary and collector contract.
