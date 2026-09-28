import {
	buildSessionProjection,
	compact,
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
