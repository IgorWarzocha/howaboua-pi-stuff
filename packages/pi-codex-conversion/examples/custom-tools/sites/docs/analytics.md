# Analytics operations

Analytics queries require a Site project and a window within the last 30 days: inclusive `start_time_ms`, exclusive `end_time_ms`. Narrow queries instead of requesting unbounded output.

## `analytics.overview`

Get aggregate analytics with `granularity` of `1h` or `1d`. Both timestamps align to that bucket anchored at fixed UTC-08:00.

## `analytics.events`

List event names observed in the requested time range. Use this before querying an unfamiliar event.

## `analytics.query`

Query an exact `event_name` from `analytics.events`. Both timestamps align to daily buckets anchored at fixed UTC-08:00.

Analytics can contain operational or visitor-derived information. Return only what the task needs and avoid copying large event payloads into model context.
