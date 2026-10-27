import { calculateCost, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import type { ResponsesStreamOutput } from "./output-items.ts";

export function completeResponsesOutput<TApi extends Api>(event: Extract<ResponseStreamEvent, { type: "response.completed" | "response.incomplete" }>, state: ResponsesStreamOutput, model: Model<TApi>): void {
	const { output, outputStates, options } = state;
	const response = event.response;
	if (response?.id) output.responseId = response.id;
	if (response?.usage) {
		const inputDetails = response.usage.input_tokens_details as { cached_tokens?: number; cache_write_tokens?: number } | undefined;
		const cachedTokens = inputDetails?.cached_tokens || 0;
		const cacheWriteTokens = inputDetails?.cache_write_tokens || 0;
		output.usage = {
			input: Math.max(0, (response.usage.input_tokens || 0) - cachedTokens - cacheWriteTokens),
			output: response.usage.output_tokens || 0,
			cacheRead: cachedTokens,
			cacheWrite: cacheWriteTokens,
			totalTokens: response.usage.total_tokens || 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		(output.usage as { reasoning?: number }).reasoning = response.usage.output_tokens_details?.reasoning_tokens || 0;
	}
	calculateCost(model, output.usage);
	if (options?.applyServiceTierPricing) {
		const serviceTier = options.resolveServiceTier
			? options.resolveServiceTier(response?.service_tier, options.serviceTier)
			: (response?.service_tier ?? options.serviceTier);
		options.applyServiceTierPricing(output.usage, serviceTier);
	}
	const incompleteDetails = response?.incomplete_details as { reason?: unknown } | null | undefined;
	const incompleteReason = typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : undefined;
	const rawStopReason = incompleteReason ? `${response?.status}.${incompleteReason}` : response?.status;
	if (rawStopReason !== undefined) output.rawStopReason = rawStopReason;
	const mappedStop = mapStopReason(response?.status, incompleteReason);
	output.stopReason = mappedStop.stopReason;
	if (mappedStop.errorMessage === undefined) delete output.errorMessage;
	else output.errorMessage = mappedStop.errorMessage;
	if (output.content.some((block) => block.type === "toolCall") && output.stopReason === "stop") {
		output.stopReason = "toolUse";
	}
	if ([...outputStates.values()].some((state) => state.kind === "function_call" || state.kind === "custom_tool_call")) {
		output.stopReason = "error";
		output.errorMessage = "Invalid Responses tool stream: response ended with an unfinished tool call";
	}
}

function mapStopReason(
	status: string | undefined,
	incompleteReason?: string,
): { stopReason: AssistantMessage["stopReason"]; errorMessage?: string } {
	if (!status) return { stopReason: "pending" };
	switch (status) {
		case "completed":
			return { stopReason: "stop" };
		case "incomplete":
			if (incompleteReason === "max_output_tokens") return { stopReason: "length" };
			return {
				stopReason: "error",
				errorMessage: incompleteReason
					? `Response incomplete: ${incompleteReason}`
					: "Response incomplete without a provider reason",
			};
		case "failed":
		case "cancelled":
			return { stopReason: "error" };
		case "in_progress":
		case "queued":
			return { stopReason: "pending" };
		default:
			throw new Error(`Unhandled stop reason: ${status}`);
	}
}
