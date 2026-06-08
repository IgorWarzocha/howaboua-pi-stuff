import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ResponsesCompatibleRequestPayload } from "./compaction-runtime.ts";
import type { NativeCompactionEntry } from "./types.js";
import {
	compareResponsesInputParity,
	serializeMessagesToResponsesInput,
	type ResponsesInputItem,
	type ResponsesInputMessageItem,
} from "./serializer.js";
import { areEquivalentValues, cloneOpaqueCompactedWindow, cloneResponsesInputMessageItem, cloneResponsesInputSlice, isPreambleRole, isResponsesInputMessageItem } from "./payload-structured.ts";
import { toPiReplayAgentMessage, toReplayAgentMessage } from "./replay-message-conversion.ts";

export type FreshAuthoritativePreamble = {
	instructions?: string | undefined;
	leadingInput: ResponsesInputMessageItem[];
	trailingInput: ResponsesInputMessageItem[];
};

export type SerializedReplaySlice = {
	entries: SessionEntry[];
	messages: AgentMessage[];
	input: ResponsesInputItem[];
};

export type NativeReplaySegments = {
	boundaryIndex: number;
	firstKeptEntryIndex: number;
	instructions?: string | undefined;
	freshPreamble: ResponsesInputMessageItem[];
	trailingPreamble: ResponsesInputMessageItem[];
	compactionSummary: ResponsesInputItem[];
	preCompactionKeptWindow: SerializedReplaySlice;
	compactedWindow: unknown[];
	postCompactionTail: SerializedReplaySlice;
	originalPiReplayInput: ResponsesInputItem[];
	replayInput: unknown[];
};

export type NativeReplayPayloadRewrite = {
	ok: true;
	segments: NativeReplaySegments;
	rewrittenPayload: ResponsesCompatibleRequestPayload;
};

export type NativeReplayPayloadRewriteFailureReason =
	| "compaction-boundary-not-found"
	| "first-kept-entry-not-found"
	| "unsupported-instructions"
	| "invalid-compacted-window"
	| "unexpected-compaction-after-boundary"
	| "expected-pi-replay-mismatch";

export type NativeReplayPayloadRewriteFailure = {
	ok: false;
	reason: NativeReplayPayloadRewriteFailureReason;
	parity?: {
		actual: string[];
		expected: string[];
		mismatches: string[];
	} | undefined;
};

export type NativeReplayPayloadRewriteResult =
	| NativeReplayPayloadRewrite
	| NativeReplayPayloadRewriteFailure;

type ReplayMessageSet = {
	messages: AgentMessage[];
	input: ResponsesInputItem[];
};

type ReplayMatch = {
	originalPiReplayInput: ResponsesInputItem[];
	preCompactionKept: ReplayMessageSet;
	postCompactionTail: ReplayMessageSet;
	actualPostCompactionTail: ResponsesInputItem[];
	extraPostCompactionTail: ResponsesInputItem[];
};

function isPromptEnvelopeItem(item: unknown): item is ResponsesInputMessageItem {
	return isResponsesInputMessageItem(item) && isPreambleRole(item.role);
}

export function extractFreshAuthoritativePreamble(
	payload: ResponsesCompatibleRequestPayload,
): FreshAuthoritativePreamble | undefined {
	if (payload.instructions !== undefined && typeof payload.instructions !== "string") {
		return undefined;
	}

	// Developer/system items in Pi's Responses payload are prompt-level instructions,
	// not transcript entries from session history. Preserve them in the same leading
	// or trailing position that Pi authored so provider-added suffix prompts like
	// GPT-5's trailing developer "# Juice: 0 !important" survive replay unchanged.
	let leadingBoundary = 0;
	while (leadingBoundary < payload.input.length && isPromptEnvelopeItem(payload.input[leadingBoundary]!)) {
		leadingBoundary += 1;
	}

	let trailingBoundary = payload.input.length;
	while (trailingBoundary > leadingBoundary && isPromptEnvelopeItem((payload.input[trailingBoundary - 1])!)) {
		trailingBoundary -= 1;
	}

	for (let index = leadingBoundary; index < trailingBoundary; index++) {
		if (isPromptEnvelopeItem(payload.input[index]!)) {
			return undefined;
		}
	}

	return {
		...(typeof payload.instructions === "string" ? { instructions: payload.instructions } : {}),
		leadingInput: payload.input.slice(0, leadingBoundary).map((item) => cloneResponsesInputMessageItem(item as ResponsesInputMessageItem)),
		trailingInput: payload.input
			.slice(trailingBoundary)
			.map((item) => cloneResponsesInputMessageItem(item as ResponsesInputMessageItem)),
	};
}

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

function createCompactionSummaryAgentMessage(entry: NativeCompactionEntry): AgentMessage {
	return {
		role: "compactionSummary",
		summary: entry.summary,
		tokensBefore: entry.tokensBefore,
		timestamp: new Date(entry.timestamp).getTime(),
	} as AgentMessage;
}

function createReplaySlice(
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

function buildLenientNativeReplayPayload(args: {
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

function findReplayMatch<TApi extends Api>(args: {
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

function findEntryIndexByIdBeforeBoundary(
	entries: readonly SessionEntry[],
	entryId: string,
	boundaryIndex: number,
): number | undefined {
	const index = entries.findIndex((entry, candidateIndex) => candidateIndex < boundaryIndex && entry.id === entryId);
	return index >= 0 ? index : undefined;
}

export function findCompactionBoundaryIndex(
	entries: readonly SessionEntry[],
	compactionEntryId: string,
): number | undefined {
	const boundaryIndex = entries.findIndex((entry) => entry.id === compactionEntryId);
	return boundaryIndex >= 0 ? boundaryIndex : undefined;
}

export function findEntriesStrictlyAfterCompactionBoundary(
	entries: readonly SessionEntry[],
	compactionEntryId: string,
): SessionEntry[] | undefined {
	const boundaryIndex = findCompactionBoundaryIndex(entries, compactionEntryId);
	if (boundaryIndex === undefined) {
		return undefined;
	}

	return entries.slice(boundaryIndex + 1);
}

export function collectLiveTailMessages(entries: readonly SessionEntry[]): AgentMessage[] {
	return collectReplayMessages(entries);
}

export function serializeLiveTailToResponsesInput<TApi extends Api>(args: {
	model: Model<TApi>;
	entries: readonly SessionEntry[];
}): ResponsesInputItem[] {
	return serializeMessagesToResponsesInput(args.model, collectReplayMessages(args.entries));
}

function buildNativeReplaySegmentsInternal<TApi extends Api>(args: {
	model: Model<TApi>;
	payload: ResponsesCompatibleRequestPayload;
	branchEntries: readonly SessionEntry[];
	compactionEntry: NativeCompactionEntry;
}): NativeReplayPayloadRewriteResult {
	const boundaryIndex = findCompactionBoundaryIndex(args.branchEntries, args.compactionEntry.id);
	if (boundaryIndex === undefined) {
		return {
			ok: false,
			reason: "compaction-boundary-not-found",
		};
	}

	const firstKeptEntryIndex = findEntryIndexByIdBeforeBoundary(
		args.branchEntries,
		args.compactionEntry.firstKeptEntryId,
		boundaryIndex,
	);
	if (firstKeptEntryIndex === undefined) {
		return {
			ok: false,
			reason: "first-kept-entry-not-found",
		};
	}

	const freshPreamble = extractFreshAuthoritativePreamble(args.payload);
	if (!freshPreamble) {
		return {
			ok: false,
			reason: "unsupported-instructions",
		};
	}

	const compactedWindow = cloneOpaqueCompactedWindow(args.compactionEntry.details?.compactedWindow ?? []);
	if (!compactedWindow) {
		return {
			ok: false,
			reason: "invalid-compacted-window",
		};
	}

	const newerCompactionEntry = args.branchEntries
		.slice(boundaryIndex + 1)
		.some((entry) => entry.type === "compaction");
	if (newerCompactionEntry) {
		const compactionSummaryInput = serializeMessagesToResponsesInput(args.model, [createCompactionSummaryAgentMessage(args.compactionEntry)]);
		const lenientReplay = buildLenientNativeReplayPayload({ payload: args.payload, freshPreamble, compactedWindow, compactionSummaryInput });
		const originalPiReplayInput = cloneResponsesInputSlice(args.payload.input);
		if (!lenientReplay || !originalPiReplayInput) {
			return {
				ok: false,
				reason: "unexpected-compaction-after-boundary",
			};
		}

		return {
			ok: true,
			segments: {
				boundaryIndex,
				firstKeptEntryIndex,
				instructions: freshPreamble.instructions,
				freshPreamble: freshPreamble.leadingInput,
				trailingPreamble: freshPreamble.trailingInput,
				compactionSummary: [],
				preCompactionKeptWindow: createReplaySlice([], [], []),
				compactedWindow,
				postCompactionTail: createReplaySlice(args.branchEntries.slice(boundaryIndex + 1), [], lenientReplay.conversationInput),
				originalPiReplayInput,
				replayInput: lenientReplay.input,
			},
			rewrittenPayload: {
				...args.payload,
				...(freshPreamble.instructions !== undefined ? { instructions: freshPreamble.instructions } : {}),
				input: lenientReplay.input,
			},
		};
	}

	const preCompactionEntries = args.branchEntries.slice(firstKeptEntryIndex, boundaryIndex);
	const postCompactionEntries = args.branchEntries.slice(boundaryIndex + 1);
	const contextPostCompactionTailMessages = collectReplayMessages(postCompactionEntries);
	const compactionSummaryMessage = createCompactionSummaryAgentMessage(args.compactionEntry);
	const replayMatch = findReplayMatch({
		model: args.model,
		payloadInput: args.payload.input,
		freshPreamble,
		compactionSummaryMessage,
		preCompactionEntries,
		postCompactionEntries,
	});

	if (!replayMatch) {
		const compactionSummaryInput = serializeMessagesToResponsesInput(args.model, [compactionSummaryMessage]);
		const lenientReplay = buildLenientNativeReplayPayload({ payload: args.payload, freshPreamble, compactedWindow, compactionSummaryInput });
		if (lenientReplay) {
			return {
				ok: true,
				segments: {
					boundaryIndex,
					firstKeptEntryIndex,
					instructions: freshPreamble.instructions,
					freshPreamble: freshPreamble.leadingInput,
					trailingPreamble: freshPreamble.trailingInput,
					compactionSummary: compactionSummaryInput,
					preCompactionKeptWindow: createReplaySlice(preCompactionEntries, [], []),
					compactedWindow,
					postCompactionTail: createReplaySlice(postCompactionEntries, [], lenientReplay.conversationInput),
					originalPiReplayInput: cloneResponsesInputSlice(args.payload.input) ?? [],
					replayInput: lenientReplay.input,
				},
				rewrittenPayload: {
					...args.payload,
					...(freshPreamble.instructions !== undefined ? { instructions: freshPreamble.instructions } : {}),
					input: lenientReplay.input,
				},
			};
		}
		const expectedInput = [
			...freshPreamble.leadingInput,
			...compactionSummaryInput,
			...serializeMessagesToResponsesInput(args.model, collectReplayMessages(preCompactionEntries)),
			...serializeMessagesToResponsesInput(args.model, collectReplayMessages(postCompactionEntries)),
			...freshPreamble.trailingInput,
		];
		const parity = compareResponsesInputParity(args.payload.input, expectedInput);
		return {
			ok: false,
			reason: "expected-pi-replay-mismatch",
			parity: {
				actual: parity.actual,
				expected: parity.expected,
				mismatches: parity.mismatches,
			},
		};
	}

	const freshPreambleCount = freshPreamble.leadingInput.length;
	const compactionSummaryCount = serializeMessagesToResponsesInput(args.model, [compactionSummaryMessage]).length;
	const preCompactionKeptCount = replayMatch.preCompactionKept.input.length;
	const actualCompactionSummary = cloneResponsesInputSlice(
		args.payload.input.slice(freshPreambleCount, freshPreambleCount + compactionSummaryCount),
	);
	const actualPreCompactionKeptWindow = cloneResponsesInputSlice(
		args.payload.input.slice(
			freshPreambleCount + compactionSummaryCount,
			freshPreambleCount + compactionSummaryCount + preCompactionKeptCount,
		),
	);
	const actualPostCompactionTail = replayMatch.actualPostCompactionTail;
	const contextPostCompactionTail = [
		...serializeMessagesToResponsesInput(args.model, contextPostCompactionTailMessages),
		...replayMatch.extraPostCompactionTail,
	];
	if (!actualCompactionSummary || !actualPreCompactionKeptWindow || !actualPostCompactionTail) {
		return {
			ok: false,
			reason: "expected-pi-replay-mismatch",
		};
	}

	const preCompactionKeptWindow = createReplaySlice(
		preCompactionEntries,
		replayMatch.preCompactionKept.messages,
		actualPreCompactionKeptWindow,
	);
	const postCompactionTail = createReplaySlice(
		postCompactionEntries,
		contextPostCompactionTailMessages,
		contextPostCompactionTail,
	);

	return {
		ok: true,
		segments: {
			boundaryIndex,
			firstKeptEntryIndex,
			instructions: freshPreamble.instructions,
			freshPreamble: freshPreamble.leadingInput,
			trailingPreamble: freshPreamble.trailingInput,
			compactionSummary: actualCompactionSummary,
			preCompactionKeptWindow,
			compactedWindow,
			postCompactionTail,
			originalPiReplayInput: replayMatch.originalPiReplayInput,
			replayInput: [
				...freshPreamble.leadingInput,
				...compactedWindow,
				...contextPostCompactionTail,
				...freshPreamble.trailingInput,
			],
		},
		rewrittenPayload: {
			...args.payload,
			...(freshPreamble.instructions !== undefined ? { instructions: freshPreamble.instructions } : {}),
			input: [
				...freshPreamble.leadingInput,
				...compactedWindow,
				...contextPostCompactionTail,
				...freshPreamble.trailingInput,
			],
		},
	};
}

export function buildNativeReplaySegments<TApi extends Api>(args: {
	model: Model<TApi>;
	payload: ResponsesCompatibleRequestPayload;
	branchEntries: readonly SessionEntry[];
	compactionEntry: NativeCompactionEntry;
}): NativeReplayPayloadRewriteResult {
	return buildNativeReplaySegmentsInternal(args);
}

export function rewriteResponsesPayloadWithNativeReplay<TApi extends Api>(args: {
	model: Model<TApi>;
	payload: ResponsesCompatibleRequestPayload;
	branchEntries: readonly SessionEntry[];
	compactionEntry: NativeCompactionEntry;
}): NativeReplayPayloadRewriteResult {
	return buildNativeReplaySegmentsInternal(args);
}
