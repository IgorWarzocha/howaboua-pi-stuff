import { createHash } from "node:crypto";
import { isResponsesLiteRequest } from "./responses-lite.ts";
import type { CodexRequestDiagnostics, ResponsesBody } from "./types.ts";

/** Reduce request state before it crosses the diagnostics privacy boundary. */
export function codexRequestDiagnostics(body: ResponsesBody, headers: Headers, headersSent = true): CodexRequestDiagnostics {
	const metadata = body.client_metadata;
	const kind = metadata?.["x-openai-subagent"] ?? headers.get("x-openai-subagent");
	const guardianReviewer = headers.get("x-codex-guardian") === "reviewer";
	const effort = body.reasoning?.effort;
	const tier = body.service_tier;
	const lite = isResponsesLiteRequest(body);
	const first = body.input[0] as Record<string, unknown> | undefined;
	const leadingInstructions: unknown[] = [];
	if (body.instructions === undefined) {
		for (const item of body.input.slice(lite ? 1 : 0)) {
			if (!item || typeof item !== "object" || !("role" in item) || item.role !== "developer") break;
			leadingInstructions.push(item);
		}
	}
	const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
	return {
		instructionsFingerprint: fingerprint(body.instructions ?? leadingInstructions),
		toolsFingerprint: fingerprint(lite ? first?.["tools"] : body.tools),
		cacheKeyFingerprint: fingerprint(body.prompt_cache_key),
		routingFingerprint: fingerprint(["x-codex-routing-hint", "originator", "openai-beta", "x-openai-internal-codex-responses-lite"].map(name => [name, headers.get(name)])),
		optionsFingerprint: fingerprint({ model: body.model, reasoning: body.reasoning, text: body.text,
			tool_choice: body.tool_choice, parallel_tool_calls: body.parallel_tool_calls,
			service_tier: body.service_tier, access_programs: body.access_programs,
			prompt_cache_retention: body["prompt_cache_retention"], store: body.store,
			temperature: body.temperature, include: body.include, max_output_tokens: body["max_output_tokens"],
			truncation: body["truncation"], responsesLite: lite }),
		headersSent,
		reasoningEffort: effort && ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : effort ? "other" : "unset",
		serviceTier: tier && ["auto", "default", "flex", "priority", "ultrafast"].includes(tier) ? tier : tier ? "other" : "unset",
		accessProgram: body.access_programs?.cyber === "standard" || body.access_programs?.cyber === "daybreak_blue" || body.access_programs?.cyber === "daybreak_red" ? body.access_programs.cyber : "unset",
		responsesLite: isResponsesLiteRequest(body),
		routingHint: headers.has("x-codex-routing-hint") ? "present" : guardianReviewer ? "guardian_suppressed" : "absent",
		guardianReviewer,
		parentThreadLinked: Boolean(metadata?.["x-codex-parent-thread-id"] || headers.get("x-codex-parent-thread-id")),
		subagentKind: kind && ["collab_spawn", "explorer", "reviewer", "general"].includes(kind) ? kind : kind ? "other" : "none",
	};
}
