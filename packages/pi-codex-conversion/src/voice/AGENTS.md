# Realtime voice

- `controller.ts` owns Pi/auth/session lifecycle; the native helper never reads credential stores or executes agent work.
- Helper IPC is versioned JSONL on stdio. Stdout is protocol-only; diagnostics go to stderr. Validate and bound every wire string/blob.
- V3 conversation and V2 dictation share audio devices but keep independent transport state. No implicit fallback between them.
- One controller owns helper process, cancellation, and cleanup. Session replacement/reload/shutdown must make stop idempotent.
- Live network and hardware checks stay opt-in; deterministic tests own parsing, state, framing, resampling, and cleanup.
