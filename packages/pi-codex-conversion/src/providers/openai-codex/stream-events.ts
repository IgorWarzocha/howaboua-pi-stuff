import { processResponsesStream } from "../openai-responses/shared.ts";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { CODEX_RESPONSE_STATUSES } from "./constants.ts";
import { applyServiceTierPricing, resolveCodexServiceTier } from "./usage.ts";
import type { OpenAICodexStreamOptions, ServiceTier, StreamEventShape } from "./types.ts";

export async function* mapCodexEvents(events: AsyncIterable<StreamEventShape>): AsyncIterable<StreamEventShape> {
	let sawTerminalResponse = false;
	for await (const event of events) {
		const type = typeof event.type === "string" ? event.type : undefined;
		if (!type) continue;

		if (type === "error") {
			throw new Error(`Codex error: ${event.message || event.code || JSON.stringify(event)}`);
		}

		if (type === "response.failed") {
			throw new Error(event.response?.error?.message || "Codex response failed");
		}

		if (type === "response.done" || type === "response.completed" || type === "response.incomplete") {
			sawTerminalResponse = true;
			const response = event.response;
			yield {
				...event,
				type: "response.completed",
				response: response ? { ...response, status: normalizeCodexStatus(response.status) } : response,
			};
			return;
		}

		yield event;
	}

	if (!sawTerminalResponse) {
		throw new Error("Stream closed before response.completed");
	}
}

function normalizeCodexStatus(status: string | undefined): string | undefined {
	if (typeof status !== "string") return undefined;
	return CODEX_RESPONSE_STATUSES.has(status) ? status : undefined;
}

export async function processCodexResponsesStream<TApi extends Api>(
	events: AsyncIterable<StreamEventShape>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	options: OpenAICodexStreamOptions | undefined,
): Promise<void> {
	await processResponsesStream(mapCodexEvents(events) as AsyncIterable<never>, output, stream, model, {
		serviceTier: (options as { serviceTier?: ServiceTier | undefined } | undefined)?.serviceTier,
		resolveServiceTier: resolveCodexServiceTier,
		applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model as Model<Api>),
	});
}
