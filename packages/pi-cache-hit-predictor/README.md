# @howaboua/pi-cache-hit-predictor

Shows an inline cache-hit prediction when you switch Pi models or reasoning levels.

```text
Cache hit prediction · gpt-5.6-sol · low: ~27k / ~104k (26%) cached
```

The prediction is a UI-only transcript notification. It is not sent to the model and does not change the prompt. Back-to-back predictions update the same line while you cycle through models or reasoning levels.

## Install

```bash
pi install npm:@howaboua/pi-cache-hit-predictor
```

Try it for one session:

```bash
pi -e npm:@howaboua/pi-cache-hit-predictor
```

## How it works

The extension treats each provider, API, model, and reasoning level combination as a separate cache lane. It remembers the prompt size from the latest successful request in each lane. When you return to one, the old prompt size is the prefix that may still be reusable.

For example, if `low` last saw 25k tokens and the session grew to 100k on `high`, switching back predicts a hit of up to 25k, or 25%. The next completed request refreshes that lane with the larger prompt.

This is an estimate, not provider preflight data. Provider expiry or eviction, compaction, branch summaries, changed tools or system instructions, and provider serialization can change the actual hit. The provider's `cacheRead` usage remains the final result.

## Local development

```bash
bun install
bun run check
bun run pack:dry
pi -e ./index.ts
```
