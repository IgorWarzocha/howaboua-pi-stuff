import {
	compact,
	type CompactionResult,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	uuidv7,
	type Api,
	type AssistantMessageEventStream,
	type Model,
	type ProviderHeaders,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { openAICodexResponsesApi, openAIResponsesApi, streamSimple } from "@earendil-works/pi-ai/compat";
import { serializeMessagesToResponsesInput } from "./serializer.ts";
import { encryptedToolOutputFromDetails, opaqueToolOutputsFromDetails } from "../../providers/openai-responses/native-items.ts";

type PortableSummaryStream = (
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

const streamPortableSummary: PortableSummaryStream = (model, context, options) => {
	if (model.api === "openai-codex-responses") {
		return openAICodexResponsesApi().streamSimple(model, context, options);
	}
	if (model.api === "openai-responses") {
		return openAIResponsesApi().streamSimple(model, context, options);
	}
	return streamSimple(model, context, options);
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
	const summarized = [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages];
	// Pi's summary transcript is text. Protected tool output must remain native,
	// paired with its actual call, rather than turning opaque receipts into history.
	const protectedCalls = new Set(summarized.flatMap(message => message.role === "toolResult"
		&& (encryptedToolOutputFromDetails(message.details) || opaqueToolOutputsFromDetails(message.details).length)
		? [message.toolCallId] : []));
	const reads = summarized.flatMap((message): AgentMessage[] => {
		if (message.role === "toolResult" && protectedCalls.has(message.toolCallId)) return [message];
		if (message.role !== "assistant") return [];
		const content = message.content.filter(part => part.type === "toolCall" && protectedCalls.has(part.id));
		return content.length ? [{ ...message, content }] : [];
	});
	const responses = options.model.api === "openai-codex-responses" || options.model.api === "openai-responses";
	if (!responses && reads.length)
		throw new Error("Encrypted tool results need their matching Responses provider before Pi compaction");
	const prefix = responses ? serializeMessagesToResponsesInput(options.model, reads) : [];
	const onPayload: SimpleStreamOptions["onPayload"] = prefix.length ? async (payload, model) => {
		if (!payload || typeof payload !== "object" || !("input" in payload) || !Array.isArray(payload.input))
			throw new Error("Pi compaction has no Responses input for encrypted tool results");
		// The isolated stock provider does not serialize encrypted tool details.
		const body = { ...payload, input: [...prefix, ...payload.input] };
		return (await options.onPayload?.(body, model)) ?? body;
	} : options.onPayload;
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
				...(onPayload ? { onPayload } : {}),
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
