# PCC takeover contract, protocol 1

This contract is implemented by Pi Codex Conversion in this checkout and by this extension's `src/bridge.ts`. The extension stays inactive when legacy context tools exist without an acknowledged bridge.

Use Pi's public `pi.events` bus. Do not import PCC internals into this package or create a dependency cycle. `src/bridge.ts` defines the exact TypeScript signatures. Bus objects and callbacks are process-local, not serialized session data.

## Discovery and one registration owner

Two request channels use synchronous callbacks:

```ts
// PCC asks whether an external continuity owner is installed.
pi.events.emit("pi-notes-compaction:owner:v1", {
  protocol: 1,
  reply(owner) { /* retain the NotesOwner for this runtime */ }
})

// PCC publishes its optional adapter before session_start.
pi.events.on("pi-notes-compaction:bridge:v1", request => {
  if (request.protocol === 1) request.reply(bridge)
})
```

Every extension finishes loading before `session_start`. Both sides must discover again at that boundary. PCC must check for the external owner before its first session initialization and before every activation-plan or tool rewrite. This works in either load order. No prefix edit, timer or module-global import is discovery.

`bridge.claim(owner)` returns either `{ claimed: false, reason }` or `{ claimed: true, registerTools }`. A success synchronously transfers continuity policy ownership. The callback `registerTools(tools, ctx)` registers the supplied four definitions **through PCC's own `pi.registerTool` API**, replacing PCC's existing definitions in place. The new extension does not register duplicate names when takeover succeeds. Pi cannot unregister tools. Hiding a legacy definition in another extension is not sufficient because registry precedence depends on extension order.

PCC may defer its legacy registrations until discovery, but it must still use the same PCC-owned registration callback on takeover. With no external owner, PCC retains all existing behavior. A failed claim must leave its legacy owner intact. Do not acknowledge a partial takeover.

## PCC owners that must yield

Add an explicit external-owner branch to `adapter/activation/runtime-plan.ts` and every continuity consumer. The external owner takes notes, history routing, context identities, reminders, manual checkpoint policy, idle input admission and window rollover. Disable PCC's corresponding Local, Tree and Remote policy owners, not its provider services.

Required boundaries in the current source:

- `context-management/tools.ts` and `extension/tools.ts`: replace the four tools through the registration callback. Active-tool and schema rewrites must preserve delegated definitions. Do not reinstall legacy routers on model changes or settings changes.
- `extension/session-lifecycle.ts` and `extension/turn-lifecycle.ts`: skip legacy notes/window initialization, input holding, checkpoint admission, note freshness, reminders, settlement records and continuation scheduling. Leave PCC's prompt preparation, runtime synchronization, Notebook status, voice, quota and provider lifecycle active.
- `extension/compaction-lifecycle.ts`: skip only legacy `contextWindows.prepareCompaction` and notes checkpoint overrides. When this extension allows normal compaction, run the unchanged installed PCC normal-compaction path. Overflow stays in the same window. Notebook checkpointing, native compaction, replay, transport reset and presentation remain PCC-owned.
- `context-management/window-manager.ts`, `window-request.ts` and native replay serializers: use `owner.identity(ctx)` and `owner.projectBranch(entries)` for the active window and retirement boundary. Preserve PCC request metadata and zero-based generation semantics. Do not recreate remote history-ingest requirements for local notes.
- PCC message preparation and `adapter/developer-messages.ts`: preserve `notes-compaction:window:v1` and `notes-compaction:checkpoint:v1` custom messages on every model. Compatible Responses routes may promote them to developer messages. Ordinary Pi conversion must retain them on other routes. Use `owner.projectMessages(messages)` before native replay/prewarm, without overwriting another extension's preparation.
- Settings UI: show notes continuity as externally managed. Preserve old PCC values for sessions without the external extension. Do not add another compaction setting to this extension.

Normal compaction output belongs exclusively to Pi and PCC. This package does not port V2, copy encrypted compaction checkpoints or persist its own compaction records.

`beforeWindow(ctx, signal?)` is optional. PCC can checkpoint Notebook and reset owned transport/window state there. It must fail before a new marker is appended if preparation fails. A rollover continuation is a settled **user** kickoff. Both the checkpoint and successor must run the complete `input` and `before_agent_start` chain, not a captured prompt or developer-message turn.

## Code and Notebook

`configureTools(tools, ctx, contracts)` receives the delegated definitions and compact `notes` and `history` usage strings. Reuse PCC's existing `toNestedTool` and `registerCodeModeExtensionTools` machinery inside PCC:

- Defer notes/history schemas and full contracts through discovery. Keep them callable and discoverable in `ALL_TOOLS` without per-tool provider schemas or standing usage.
- Calls use ordinary query and text arguments, not encrypted model arguments.
- Plain local results remain ordinary JavaScript values. For results containing opaque remote responses, JavaScript gets a receipt and the model gets protected delivery.
- Preserve current-call and original-exec ancestry through `exec` and `wait`. Propagate the successful local note-write receipt to PCC's existing saved-note presentation if needed.
- Preserve `details.notesCompaction` on direct write results. Nested exec/wait must keep PCC's `contextNotesSaved` success or failure outcome, including a failed write after an earlier successful write. Checkpoint freshness requires completed write results, not receipt existence alone.
- `new_context` is `model-only`, sequential and **never nested**. Keep its native schema in Code and Notebook. Do not expose it through `tools` or execute a rollover under an exec cell.

Configuration is repeated on session start and model selection. It must be idempotent. Do not rewrite earlier tool calls or results.

## Remote response cache and provider projection

Optional `lookup(query, ctx, signal?)` handles read-only notes/history operations through PCC's existing authenticated backend. The query is `{ namespace: "notes" | "history", params }`. Paths sent to lookup are fully qualified virtual paths. Writes never go to the remote backend.

Return `CachedResponse[]`, with each element containing:

- `query`: the exact query whose result these bytes represent.
- `bytes`: the unchanged backend response bytes as `Uint8Array`.
- `source`: the existing backend/source identity needed to project the response.
- `encoding`: the response encoding, normally `application/json`.
- `fetchedAt`: the access timestamp in milliseconds.
- `coverage`: `complete`, `partial` or `unknown`. This describes that response, not the entire remote archive.

Return the requested response and any additional complete query responses already present on access. Do not fabricate plaintext file indexes from encrypted lists or searches. The new extension caches every returned response, then projects responses matching the requested query. A network failure reuses the newest cached exact-query response per source and labels it offline. Database or delivery failure remains a failure.

`canProject(ctx)` must return false when the active model cannot consume encrypted results. Without compatible projection, ciphertext stays cached and local data remains available.

`projectResult(result, responses, callId, ctx, signal?)` returns a fresh `AgentToolResult`. Decode only the response envelope to recover its original `encrypted_output` and useful plain attachment hint. Do not decrypt, concatenate ciphertext strings, invent an old call ID or reuse an old protected-delivery record. The provider boundary must emit the actual current tool call's function output as native blocks:

```ts
{
  type: "function_call_output",
  call_id: actualCurrentCallId,
  output: [
    { type: "input_text", text: localResultAndCoverage },
    { type: "encrypted_content", encrypted_content: unchangedEncryptedOutput }
  ]
}
```

Multiple responses stay distinct blocks. Local append overlays stay labelled as overlays, not a decrypted merge. Local replacements supersede remote path reads. Opaque lists/searches can still describe old paths, so preserve the local-authority labels.

For direct calls, extend PCC's `codexHistoryNotes` extraction and Responses conversion to accept the fresh cache-backed result. For nested calls, use PCC's existing authenticated opaque capture and protocol-2 original-exec relay. Cache-backed responses need a new honest delivery envelope for the current call. Retain necessary existing source metadata, but do not add an account-binding, portability, export or key-management framework.

**Persistence boundary:** `Uint8Array` is only the in-process adapter type. Any bytes placed in persisted result details must be encoded explicitly, for example base64 with the declared encoding. JSON serialization of a typed array is not a supported cache or replay format. SQLite stores the original BLOB. PCC retains its existing serialized opaque-delivery format where possible.

Optional `agentName(ctx)` and `route(query, callId, ctx, signal?)` adapt existing PCC family identity and sharing routes. `route` returns `undefined` for current-agent requests. For another agent it returns the normal routed result, preserving that owner's freshness and delivery semantics. Without this capability, cross-agent targets fail explicitly rather than reading another session by guesswork.

## Validation required for the PCC patch

Use the real Pi registry in both extension orders. Check that only PCC owns the four delegated registrations and that its remaining prompt/tool rewrites retain them. Capture final provider schemas and instructions separately in normal, Code and Notebook modes. Exercise direct and original-exec cached opaque delivery, including `wait`, offline lookup, incompatible model selection and persisted replay. Run abort/error checkpoint paths and a later extension's preparation hook. Existing PCC alone must remain unchanged.
