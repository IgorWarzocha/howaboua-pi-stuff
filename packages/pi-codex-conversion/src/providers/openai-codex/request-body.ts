import { clampThinkingLevel, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import { CODEX_TOOL_CALL_PROVIDERS, convertResponsesMessages, convertResponsesTools } from "../openai-responses/shared.ts";
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

export function buildRequestBody<TApi extends Api>(model: Model<TApi>, context: Context, options?: OpenAICodexStreamOptions): ResponsesBody {
	const messages = convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, {
		includeSystemPrompt: false,
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
		tool_choice: "auto",
		parallel_tool_calls: true,
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

	if (context.tools && context.tools.length > 0) {
		body.tools = convertResponsesTools(context.tools, { strict: null });
	}

	const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
	const reasoningEffort = options?.reasoningEffort ?? (clampedReasoning === "off" ? undefined : clampedReasoning);
	if (reasoningEffort !== undefined) {
		const effort = reasoningEffort === "none" ? (model.thinkingLevelMap?.off ?? "none") : (model.thinkingLevelMap?.[reasoningEffort] ?? reasoningEffort);
		if (effort === null) return body;
		body.reasoning = {
			effort: clampReasoningEffort(model.id, effort),
			summary: ((options as { reasoningSummary?: string | undefined } | undefined)?.reasoningSummary ?? "auto") as string,
		};
	}

	return body;
}
