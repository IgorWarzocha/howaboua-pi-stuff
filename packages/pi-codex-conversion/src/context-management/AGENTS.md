# Context management

- A persisted context-window message is the sole rollover boundary. Pi keeps the full JSONL; provider projection starts at the latest boundary.
- Rollover never invents a summary. Local mode recovers history and notes from append-only Pi JSONL; hybrid prefers Codex history/notes only on Codex transport and sticks local after an availability miss.
- Context UUIDs appear in window prompts and turn metadata. Request window IDs use Pi session ID plus zero-based window generation, matching Codex headers.
- In Code/Notebook, `new_context`, history and notes remain direct; only `get_context_remaining` joins the nested execution surface.
- Other Responses transports may use native `history.*` and `notes.*` namespaces. Codex transport keeps flat routers in Local and Hybrid so one plaintext call can transparently fall through and the tool surface stays stable.
- Local note writes are model-invisible custom entries. Hybrid marks any unusable remote response unavailable, completes that call locally, and stays local for the session.
- Encrypted history/notes output must remain a top-level Responses tool result; never unwrap it inside Code or Notebook execution.
