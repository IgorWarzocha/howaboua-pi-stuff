# Analytics operations

Analytics queries require a Site project and an explicit millisecond time range. Keep ranges bounded and paginate or narrow queries instead of requesting unbounded output.

## `analytics.overview`

Get aggregate Site analytics between `start_time_ms` and `end_time_ms`. Optional `granularity` values are defined by the current backend schema.

## `analytics.events`

List event names observed in the requested time range. Use this before querying an unfamiliar event.

## `analytics.query`

Query one exact `event_name` over a bounded time range. Event names and IDs are opaque backend values; do not invent or normalize them.

Analytics can contain operational or visitor-derived information. Return only what the task needs and avoid copying large event payloads into model context.
