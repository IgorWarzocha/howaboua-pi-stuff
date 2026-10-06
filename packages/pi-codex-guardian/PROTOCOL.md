# Codex Guardian protocol mapping

This adapter uses the Codex backend's Guardian request contract. It is not the Codex Rust runtime. The reference is [`openai/codex` at `822e58cc3d`](https://github.com/openai/codex/tree/822e58cc3d666166c7446c5b1ea2e52f5d09594/codex-rs). The following accounts for the eligible parent, reviewer body, final HTTP headers, and conditional runtime fields.

## Eligibility and linkage

Upstream [`core/src/client.rs`](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594/codex-rs/core/src/client.rs) separates `uses_codex_backend`, supported Codex routes, reviewer-model matching, and basic-session exclusion. These are local predicates, not headers or body flags.

| Upstream condition | Pi mapping |
|---|---|
| ChatGPT subscription auth uses the Codex backend | Codex Responses API, stored OAuth source, subscription OAuth provider, and Pi's OAuth selection must all agree |
| OpenAI provider requires native auth, with no environment API key, experimental bearer token, custom auth handler, or AWS auth | No API-key handler, runtime credential override, legacy OAuth override, or legacy stream override. Native provider registrations such as Conversion remain supported |
| Provider supports Codex backend routes | Both effective provider and model use canonical ChatGPT base URLs. Pi's three supported URL spellings normalize to the same `/backend-api/codex/responses` endpoint. Custom hosts do not qualify. A provider alias alone neither grants nor removes eligibility |
| Reviewer header configuration matches the selected model | Review model is fixed to `codex-auto-review`. No fallback to the parent model or user-selected replacement |
| Parent is neither a reviewer nor a basic Guardian session | A Guardian model or `x-openai-subagent=guardian` never earns parent credits. Other subagents are not categorically excluded |
| Eligible ordinary request earns a credit request | Remove stale attribution first, then set `client_metadata.guardian_credits_requested="true"`. Ordinary requests have no `parent_response_id` |
| Reviewer links to its real parent | `client_metadata.parent_response_id` is the observed completed response that issued the action. Never a top-level parameter or a generated response ID. Reviewer metadata contains no credit request |

The final review endpoint is checked again immediately before fetch. Bearer and account headers must be present. Loaded extensions and provider registrations remain trusted host code. These client-side conditions do not establish the backend's billing decision.

## Final reviewer request

| Field family | Adapter behavior |
|---|---|
| Destination and transport | Canonical ChatGPT Codex `/responses`, POST, SSE, no redirects, retries, WebSocket fallback, or alternate model. A 30-second deadline includes authentication |
| Auth and configured headers | The active provider supplies real `Authorization` and `chatgpt-account-id`. Preserve other configured headers unless they conflict with the fresh reviewer state below. Preserve real `x-openai-internal-codex-residency`; never invent a residency requirement |
| Harness identity | Force `originator=codex_cli_rs`. User-Agent begins `codex_cli_rs`, includes the actual OS release and architecture, and names `pi-codex-guardian`. It does not invent a Rust binary version, terminal identity, or installed Codex runtime |
| Reviewer identity | Force `x-codex-guardian=reviewer` and `x-openai-subagent=guardian` at final fetch. The latter is also in body metadata |
| Session and request identity | Allocate a fresh adapter-owned review thread and turn. `session-id`, `thread-id`, and `x-client-request-id` agree with body `session_id` and `thread_id`. These are real adapter correlation IDs, not IDs issued by a running Codex process |
| Parent and cache affinity | `x-codex-parent-thread-id` in headers and metadata identifies the actual Pi parent session. `prompt_cache_key=guardian:<parent-session-id>`, as upstream uses parent-thread affinity. Review transport identity remains separate |
| Window and turn projections | Body metadata and direct headers carry identical `x-codex-window-id` and `x-codex-turn-metadata`. The fresh review owns window zero and its context-window UUID. Body metadata also carries `turn_id` |
| Turn environment | Snapshot records `request_kind=turn`, `turn_trigger=guardian_review`, reviewer name, real start time, parent session, and adapter-owned identities. Pi has no Codex OS sandbox, so `sandbox=none` and `sandbox_mode=danger-full-access`. The reviewer has no REPL, recursive reviews, history ingestion, or analytics collection, which its flags report explicitly |
| Unavailable ancestry and installation state | Do not invent Codex installation ID, parent/root turn IDs, fork ancestry, thread source, subagent kind, workspace Git inventory, or tool attribution. There is no reviewer tool inventory. Those optional fields remain absent |
| Routing and service tier | Remove inherited `x-codex-routing-hint`, `x-codex-turn-state`, and `response-session-id`. Omit `service_tier`. A fresh one-shot review has no sticky server token to reuse |
| Beta and Lite | Reviewer uses ordinary Responses, even when the parent uses PCC Lite. Remove inherited `x-codex-beta-features`, `OpenAI-Beta`, and `x-openai-internal-codex-responses-lite`. Do not advertise unimplemented features. Parent capture independently accepts and retains PCC's complete Lite input |
| Attestation and telemetry | No per-review attestation signer or trace context exists here. Remove inherited `x-oai-attestation`, `x-codex-inference-call-id`, `traceparent`, `tracestate`, and `baggage` rather than replay another request's claims. Remove memory-generation, installation, and WebSocket timing headers. Do not fabricate upstream auth-environment telemetry, MCP attribution, or request-contributor metadata |
| Encoding | Preserve the provider's actual plain or zstd encoding. Decode within the size bound and compare the complete body with the action-bound payload before sending. Set JSON content type and SSE accept |

Upstream header and metadata owners are [`responses_metadata.rs`](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594/codex-rs/core/src/responses_metadata.rs), [`login/src/auth/default_client.rs`](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594/codex-rs/login/src/auth/default_client.rs), and [`codex-api/src/endpoint/responses.rs`](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594/codex-rs/codex-api/src/endpoint/responses.rs). There is no additional unconditional "Codex environment" header in this path. Environment-backed provider headers, actual runtime metadata, and backend eligibility are distinct contracts above.

## Reviewer body and deliberate differences

The adapter constructs the whole reviewer body instead of inheriting parent-model settings. It sends exact selected authorization evidence and the pending action, with `store=false`, `stream=true`, `reasoning.effort=low`, and `include=["reasoning.encrypted_content"]`. There is no previous-response continuation, output-token override, service tier, cyber access program, concurrent summary delivery, or arbitrary inherited payload field.

The assessment schema uses `text.format.type=json_schema`, `name=codex_output_schema`, and `strict=false`, matching upstream Guardian's assessment contract. It requires `outcome` and permits risk level, user authorization, and rationale. Malformed answers block execution.

Upstream can resolve reviewer models from its catalog, retain review sessions, expose inspection tools, use Lite or WebSockets, and fall back to a parent model. This adapter deliberately uses one fixed model and a fresh tool-less standard-Responses request. `tools=[]`, `tool_choice=none`, and `parallel_tool_calls=false` enforce that boundary. Its configurable Pi action scope replaces Codex's sandbox escalation boundary. None of these differences is hidden behind a claim of full runtime parity.
