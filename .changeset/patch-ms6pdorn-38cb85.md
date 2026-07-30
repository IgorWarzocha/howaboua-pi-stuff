---
"@howaboua/pi-ask": patch
"@howaboua/pi-auto-reasoning-tool": patch
"@howaboua/pi-auto-trees": patch
"@howaboua/pi-cache-hit-predictor": patch
"@howaboua/pi-codex-conversion": patch
"@howaboua/pi-dynamic-tools": patch
"@howaboua/pi-explore-subagents": patch
"@howaboua/pi-gippity-control": patch
"@howaboua/pi-gpt-switcher": patch
"@howaboua/pi-markdown-workflows": patch
"@howaboua/pi-memories": patch
"@howaboua/pi-semantic-grep": patch
"@howaboua/pi-smart-btw": patch
"@howaboua/pi-subagent-review": patch
"@howaboua/pi-vent": patch
---

Update active packages for Pi 0.83.0 and TypeBox 1.3.7; reject and retry unfinished Codex Responses results without caching them, match Codex's WebSocket, HTTP request, SSE stream, and remote-compaction retry budgets with separated request and stream failure classification, bounded retry and idle delays, turn-state replay, malformed-event tolerance, and clean replacement boundaries, stop HTTP rate limits without amplification, recover unexpected WebSocket HTTP statuses within the same turn, recover WebSocket close 1009 immediately through sticky SSE, keep fallback sticky until compaction restores WebSocket eligibility, invalidate incremental continuation across model or reasoning changes, and preserve active tool order through Code Mode prewarm and native compaction so extension tools do not invalidate cache continuations.
