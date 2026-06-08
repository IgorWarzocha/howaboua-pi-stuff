import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ResponsesCompatibleRequestPayload } from "../compaction/compaction-runtime.ts";
import { serializeMessagesToResponsesInput, type ResponsesInputItem } from "../compaction/serializer.js";
import { areEquivalentValues, cloneResponsesInputSlice } from "./payload-structured.ts";
import type { FreshAuthoritativePreamble } from "./payload-preamble.ts";
import type { NativeCompactionEntry } from "../compaction/types.js";
import { toPiReplayAgentMessage, toReplayAgentMessage } from "./replay-message-conversion.ts";

export type SerializedReplaySlice = {
	entries: SessionEntry[];
	messages: AgentMessage[];
	input: ResponsesInputItem[];
};

export type ReplayMessageSet = {
	messages: AgentMessage[];
	input: ResponsesInputItem[];
};

export type ReplayMatch = {
	originalPiReplayInput: ResponsesInputItem[];
	preCompactionKept: ReplayMessageSet;
	postCompactionTail: ReplayMessageSet;
	actualPostCompactionTail: ResponsesInputItem[];
	extraPostCompactionTail: ResponsesInputItem[];
};

export function collectReplayMessages(entries: readonly SessionEntry[]): AgentMessage[] {
	const messages: AgentMessage[] = [];

	for (const entry of entries) {
		const message = toReplayAgentMessage(entry);
		if (message) {
			messages.push(message);
		}
	}

	return messages;
}

function collectPiReplayMessages(entries: readonly SessionEntry[]): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (const entry of entries) {
		const message = toPiReplayAgentMessage(entry);
		if (message) messages.push(message);
	}
	return messages;
}

export function createCompactionSummaryAgentMessage(entry: NativeCompactionEntry): AgentMessage {
	return {
		role: "compactionSummary",
		summary: entry.summary,
		tokensBefore: entry.tokensBefore,
		timestamp: new Date(entry.timestamp).getTime(),
	} as AgentMessage;
}

export function createReplaySlice(
	entries: readonly SessionEntry[],
	messages: readonly AgentMessage[],
	input: readonly ResponsesInputItem[],
): SerializedReplaySlice {
	return {
		entries: [...entries],
		messages: [...messages],
		input: [...input],
	};
}

function createReplayMessageSet<TApi extends Api>(model: Model<TApi>, messages: AgentMessage[]): ReplayMessageSet {
	return {
		messages,
		input: serializeMessagesToResponsesInput(model, messages),
	};
}

function createReplayVariants<TApi extends Api>(args: {
	model: Model<TApi>;
	entries: readonly SessionEntry[];
}): ReplayMessageSet[] {
	const contextMessages = collectReplayMessages(args.entries);
	const piMessages = collectPiReplayMessages(args.entries);
	const contextSet = createReplayMessageSet(args.model, contextMessages);
	if (areEquivalentValues(contextMessages, piMessages)) return [contextSet];
	return [contextSet, createReplayMessageSet(args.model, piMessages)];
}

function clonePayloadConversationInput(args: {
	payloadInput: readonly unknown[];
	freshPreamble: FreshAuthoritativePreamble;
}): ResponsesInputItem[] | undefined {
	const tailEndIndex = args.payloadInput.length - args.freshPreamble.trailingInput.length;
	if (tailEndIndex < args.freshPreamble.leadingInput.length) return undefined;
	return cloneResponsesInputSlice(args.payloadInput.slice(args.freshPreamble.leadingInput.length, tailEndIndex));
}

function stripLeadingCompactionSummaryPlaceholder(args: {
	conversationInput: readonly ResponsesInputItem[];
	compactionSummaryInput: readonly ResponsesInputItem[];
}): ResponsesInputItem[] {
	if (args.compactionSummaryInput.length === 0) return [...args.conversationInput];
	if (!areEquivalentValues(args.conversationInput.slice(0, args.compactionSummaryInput.length), args.compactionSummaryInput)) {
		return [...args.conversationInput];
	}
	return [...args.conversationInput.slice(args.compactionSummaryInput.length)];
}

export function buildLenientNativeReplayPayload(args: {
	payload: ResponsesCompatibleRequestPayload;
	freshPreamble: FreshAuthoritativePreamble;
	compactedWindow: readonly unknown[];
	compactionSummaryInput: readonly ResponsesInputItem[];
}): { input: unknown[]; conversationInput: ResponsesInputItem[] } | undefined {
	const conversationInput = clonePayloadConversationInput({ payloadInput: args.payload.input, freshPreamble: args.freshPreamble });
	if (!conversationInput) return undefined;
	const replayConversationInput = stripLeadingCompactionSummaryPlaceholder({ conversationInput, compactionSummaryInput: args.compactionSummaryInput });
	return {
		conversationInput: replayConversationInput,
		input: [
			...args.freshPreamble.leadingInput,
			...args.compactedWindow,
			...replayConversationInput,
			...args.freshPreamble.trailingInput,
		],
	};
}

export function findReplayMatch<TApi extends Api>(args: {
	model: Model<TApi>;
	payloadInput: readonly unknown[];
	freshPreamble: FreshAuthoritativePreamble;
	compactionSummaryMessage: AgentMessage;
	preCompactionEntries: readonly SessionEntry[];
	postCompactionEntries: readonly SessionEntry[];
}): ReplayMatch | undefined {
	const compactionSummaryInput = serializeMessagesToResponsesInput(args.model, [args.compactionSummaryMessage]);
	const preCompactionVariants = [
		...createReplayVariants({ model: args.model, entries: args.preCompactionEntries }),
		createReplayMessageSet(args.model, []),
	];
	const postCompactionVariants = createReplayVariants({ model: args.model, entries: args.postCompactionEntries });

	for (const preCompactionKept of preCompactionVariants) {
		for (const postCompactionTail of postCompactionVariants) {
			const expectedBeforeTrailing: ResponsesInputItem[] = [
				...args.freshPreamble.leadingInput,
				...compactionSummaryInput,
				...preCompactionKept.input,
				...postCompactionTail.input,
			];
			const originalPiReplayInput: ResponsesInputItem[] = [...expectedBeforeTrailing, ...args.freshPreamble.trailingInput];
			const tailEndIndex = args.payloadInput.length - args.freshPreamble.trailingInput.length;
			const prefixMatches = areEquivalentValues(args.payloadInput.slice(0, expectedBeforeTrailing.length), expectedBeforeTrailing);
			const trailingMatches = areEquivalentValues(args.payloadInput.slice(tailEndIndex), args.freshPreamble.trailingInput);

			if (prefixMatches && trailingMatches && tailEndIndex >= expectedBeforeTrailing.length) {
				const actualPostCompactionTail = cloneResponsesInputSlice(
					args.payloadInput.slice(
						args.freshPreamble.leadingInput.length + compactionSummaryInput.length + preCompactionKept.input.length,
						tailEndIndex,
					),
				);
				const extraPostCompactionTail = cloneResponsesInputSlice(args.payloadInput.slice(expectedBeforeTrailing.length, tailEndIndex));
				if (!actualPostCompactionTail || !extraPostCompactionTail) return undefined;
				return { originalPiReplayInput, preCompactionKept, postCompactionTail, actualPostCompactionTail, extraPostCompactionTail };
			}
		}
	}

	return undefined;
}

