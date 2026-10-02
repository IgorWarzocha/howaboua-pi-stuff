import {
	buildSessionProjection,
	compact,
	convertToLlm,
	type CompactionResult,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
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
import { projectTreeHandoffReads } from "../../context-management/tree-handoff-read.ts";
import { serializeMessagesToResponsesInput } from "./serializer.ts";
import { encryptedToolOutputFromDetails } from "../../providers/openai-responses/native-items.ts";

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

/** Summarize reconstructed history, but persist only a cut on Pi's physical branch. */
export function projectPiCompactionEvent(
	event: SessionBeforeCompactEvent,
	branch: SessionEntry[],
): SessionBeforeCompactEvent {
	const physicalCut = event.branchEntries.findIndex((entry) => entry.id === event.preparation.firstKeptEntryId);
	if (physicalCut < 0) throw new Error("Pi compaction kept boundary is missing");
	const keptIds = new Set(event.branchEntries.slice(physicalCut).map((entry) => entry.id));
	const projection = buildSessionProjection(branch);
	const cut = projection.entries.findIndex((entry) => entry.sourceEntry.type !== "compaction" && keptIds.has(entry.sourceEntry.id));
	if (cut < 0) throw new Error("Projected Pi compaction kept boundary is missing");
	const summary = projection.messages.find((message) => message.role === "compactionSummary");
	const { previousSummary: _physicalSummary, ...preparation } = event.preparation;
	return {
		...event,
		preparation: {
			...preparation,
			firstKeptEntryId: projection.entries[cut]!.sourceEntry.id,
			...(summary ? { previousSummary: summary.summary } : {}),
			messagesToSummarize: projection.entries.slice(0, cut).flatMap((entry) => entry.messages)
				.filter((message) => message.role !== "system" && message.role !== "compactionSummary"),
			// The restored prefix is one cumulative summary, including any partial turn.
			turnPrefixMessages: [],
			isSplitTurn: false,
		},
	};
}

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
	// Pi flattens summaries to text. Keep the completed reads outside that text so
	// Remote encrypted outputs remain native tool results on the summary lane too.
	const reads = projectTreeHandoffReads(summarized, event.branchEntries)
		.filter(message => !summarized.includes(message));
	const responses = options.model.api === "openai-codex-responses" || options.model.api === "openai-responses";
	if (!responses && reads.some(message => message.role === "toolResult" && encryptedToolOutputFromDetails(message.details)))
		throw new Error("The encrypted handoff note needs its matching Responses provider before Pi compaction");
	const prefix = responses ? serializeMessagesToResponsesInput(options.model, reads) : [];
	const onPayload: SimpleStreamOptions["onPayload"] = prefix.length ? async (payload, model) => {
		if (!payload || typeof payload !== "object" || !("input" in payload) || !Array.isArray(payload.input))
			throw new Error("Pi compaction has no Responses input for the handoff note");
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
			!responses && reads.length
				? { ...context, messages: [context.messages[0]!, ...convertToLlm(reads), ...context.messages.slice(1)] } : context,
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
