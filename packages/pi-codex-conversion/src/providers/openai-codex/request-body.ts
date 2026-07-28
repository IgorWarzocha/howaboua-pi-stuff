import { clampThinkingLevel, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import { CODEX_TOOL_CALL_PROVIDERS, convertResponsesMessages, convertResponsesTools, splitDeferredTools } from "../openai-responses/shared.ts";
import { OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH } from "./constants.ts";
import type { OpenAICodexStreamOptions, ResponsesBody } from "./types.ts";

function clampOpenAIPromptCacheKey(key: string | undefined): string | undefined {
	if (key === undefined) return undefined;
	const chars = Array.from(key);
	if (chars.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH) return key;
	return chars.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join("");
}

function clampReasoningEffort(modelId: string, effort: string): string {
	if (effort === "none") return effort;
	const id = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
	const gpt5MinorMatch = /^gpt-5\.(\d+)/.exec(id);
	const gpt5Minor = gpt5MinorMatch ? Number.parseInt(gpt5MinorMatch[1]!, 10) : undefined;
	if (gpt5Minor !== undefined && gpt5Minor >= 2 && effort === "minimal") return "low";
	if (id === "gpt-5.1" && effort === "xhigh") return "high";
	if (id === "gpt-5.1-codex-mini") return effort === "high" || effort === "xhigh" ? "high" : "medium";
	return effort;
}

export function buildRequestBody<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: OpenAICodexStreamOptions,
): ResponsesBody {
	const supportsToolSearch = (model.compat as { supportsToolSearch?: boolean } | undefined)?.supportsToolSearch ?? false;
	const grammarToolInputProperties = options?.grammarToolInputProperties ?? new Map<string, string>();
	const supportsOpenAIGrammarTools = grammarToolInputProperties.size > 0;
	const allowedToolCallProviders = supportsOpenAIGrammarTools && !CODEX_TOOL_CALL_PROVIDERS.has(model.provider)
		? new Set([...CODEX_TOOL_CALL_PROVIDERS, model.provider])
		: CODEX_TOOL_CALL_PROVIDERS;
	const toolPlacement = splitDeferredTools(context, supportsToolSearch);
	const messages = convertResponsesMessages(model, context, allowedToolCallProviders, {
		includeSystemPrompt: false,
		grammarToolInputProperties,
		deferredTools: toolPlacement.deferred,
		toolOptions: { supportsOpenAIGrammarTools },
	});

	const body: ResponsesBody = {
		model: model.id,
		store: false,
		stream: true,
		instructions: context.systemPrompt || "You are a helpful assistant.",
		input: messages,
		text: { verbosity: ((options as { textVerbosity?: string | undefined } | undefined)?.textVerbosity ?? "low") as string },
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: clampOpenAIPromptCacheKey(options?.sessionId),
		tool_choice: options?.toolChoice ?? "auto",
		parallel_tool_calls: true,
		...(options?.sessionId ? { client_metadata: { session_id: options.sessionId, thread_id: options.sessionId } } : {}),
	};

	// The Codex ChatGPT-backed endpoint rejects output-token cap fields with
	// `Unsupported parameter: max_output_tokens`. Pi's branch summarizer passes
	// `maxTokens`, so forwarding it breaks `/tree` summaries and extensions that
	// use `ctx.navigateTree(..., { summarize: true })`.

	if ((options as { temperature?: number | undefined } | undefined)?.temperature !== undefined) {
		body.temperature = (options as { temperature?: number | undefined }).temperature;
	}

	const serviceTier = (options as { serviceTier?: string | undefined } | undefined)?.serviceTier;
	if (serviceTier !== undefined) {
		body.service_tier = serviceTier;
	}

	if (toolPlacement.immediate.length > 0) {
		body.tools = convertResponsesTools(toolPlacement.immediate, {
			strict: null,
			supportsOpenAIGrammarTools,
		});
	}

	const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
	const reasoningEffort = options?.reasoningEffort ?? (clampedReasoning === "off" ? undefined : clampedReasoning);
	if (reasoningEffort !== undefined) {
		const thinkingLevelMap = model.thinkingLevelMap as Record<string, string | null | undefined> | undefined;
		const effort = reasoningEffort === "none" ? (thinkingLevelMap?.["off"] ?? "none") : (thinkingLevelMap?.[reasoningEffort] ?? reasoningEffort);
		if (effort === null) return body;
		body.reasoning = {
			effort: clampReasoningEffort(model.id, effort),
			summary: ((options as { reasoningSummary?: string | undefined } | undefined)?.reasoningSummary ?? "auto") as string,
		};
	}

	return body;
}
