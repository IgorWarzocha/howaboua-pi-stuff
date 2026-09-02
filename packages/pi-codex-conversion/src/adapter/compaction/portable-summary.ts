import {
	compact,
	type CompactionResult,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import {
	uuidv7,
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type ProviderHeaders,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { openAICodexResponsesApi, openAIResponsesApi } from "@earendil-works/pi-ai/compat";

type PortableSummaryStream = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

const streamPortableSummary: PortableSummaryStream = (model, context, options) => {
	if (model.api === "openai-codex-responses") {
		return openAICodexResponsesApi().streamSimple(model, context, options);
	}
	if (model.api === "openai-responses") {
		return openAIResponsesApi().streamSimple(model, context, options);
	}
	throw new Error(`Portable compaction does not support API: ${model.api}`);
};

export async function runPortablePiCompaction(
	event: SessionBeforeCompactEvent,
	options: {
		model: Model<Api>;
		thinkingLevel?: ExtensionContext["thinkingLevel"];
		apiKey?: string | undefined;
		headers?: ProviderHeaders | undefined;
		env?: Record<string, string> | undefined;
		stream?: PortableSummaryStream | undefined;
		onPayload?: SimpleStreamOptions["onPayload"] | undefined;
	},
): Promise<CompactionResult> {
	const sessionId = uuidv7();
	const result = await compact(
		event.preparation,
		options.model,
		undefined,
		undefined,
		event.customInstructions,
		event.signal,
		options.thinkingLevel,
		(model, context, streamOptions) => (options.stream ?? streamPortableSummary)(
			model,
			context,
			{
				...streamOptions,
				transport: "sse",
				...(options.apiKey ? { apiKey: options.apiKey } : {}),
				...(options.headers ? { headers: options.headers } : {}),
				...(options.env ? { env: options.env } : {}),
				...(options.onPayload ? { onPayload: options.onPayload } : {}),
			},
		),
		undefined,
		undefined,
		undefined,
		sessionId,
	);
	if (event.signal.aborted) throw new Error("Portable compaction summary was aborted");
	return result;
}
