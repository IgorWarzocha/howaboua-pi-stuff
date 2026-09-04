# Context management

- A persisted context-window message is the sole rollover boundary. Pi keeps the full JSONL; provider projection starts at the latest boundary.
- Rollover never invents a summary. Local mode recovers history and notes from append-only Pi JSONL; hybrid prefers Codex history/notes only on Codex transport and sticks local after an availability miss.
- Context UUIDs appear in window prompts and turn metadata. Request window IDs use Pi session ID plus zero-based window generation, matching Codex headers.
- In Code/Notebook, `new_context`, history and notes remain direct; only `get_context_remaining` joins the nested execution surface.
- Responses wire tools use native `history.*` and `notes.*` namespaces when their arguments can stay plaintext or use the remote backend. Codex-transport local fallback must expose flat routers because that backend rejects unencrypted reserved namespaces; replay follows the exposed shape.
- Local note writes are model-invisible custom entries. Encrypted calls need one model retry after hybrid discovers remote unavailability because Pi cannot decrypt their arguments.
- Encrypted history/notes output must remain a top-level Responses tool result; never unwrap it inside Code or Notebook execution.
