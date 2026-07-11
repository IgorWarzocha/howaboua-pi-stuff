import { compareResponsesInputParity, serializeMessagesToResponsesInput } from "../compaction/serializer.js";
import { cloneOpaqueCompactedWindow, cloneResponsesInputSlice } from "./payload-structured.js";
import { extractFreshAuthoritativePreamble } from "./payload-preamble.js";
import { buildLenientNativeReplayPayload, collectReplayMessages, createCompactionSummaryAgentMessage, createReplaySlice, findReplayMatch } from "./native-replay-matching.js";
function findEntryIndexByIdBeforeBoundary(entries, entryId, boundaryIndex) {
    const index = entries.findIndex((entry, candidateIndex) => candidateIndex < boundaryIndex && entry.id === entryId);
    return index >= 0 ? index : undefined;
}
export function findCompactionBoundaryIndex(entries, compactionEntryId) {
    const boundaryIndex = entries.findIndex((entry) => entry.id === compactionEntryId);
    return boundaryIndex >= 0 ? boundaryIndex : undefined;
}
export function findEntriesStrictlyAfterCompactionBoundary(entries, compactionEntryId) {
    const boundaryIndex = findCompactionBoundaryIndex(entries, compactionEntryId);
    if (boundaryIndex === undefined) {
        return undefined;
    }
    return entries.slice(boundaryIndex + 1);
}
export function collectLiveTailMessages(entries) {
    return collectReplayMessages(entries);
}
export function serializeLiveTailToResponsesInput(args) {
    return serializeMessagesToResponsesInput(args.model, collectReplayMessages(args.entries));
}
function buildNativeReplaySegmentsInternal(args) {
    const boundaryIndex = findCompactionBoundaryIndex(args.branchEntries, args.compactionEntry.id);
    if (boundaryIndex === undefined) {
        return {
            ok: false,
            reason: "compaction-boundary-not-found",
        };
    }
    const firstKeptEntryIndex = findEntryIndexByIdBeforeBoundary(args.branchEntries, args.compactionEntry.firstKeptEntryId, boundaryIndex);
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
    const actualCompactionSummary = cloneResponsesInputSlice(args.payload.input.slice(freshPreambleCount, freshPreambleCount + compactionSummaryCount));
    const actualPreCompactionKeptWindow = cloneResponsesInputSlice(args.payload.input.slice(freshPreambleCount + compactionSummaryCount, freshPreambleCount + compactionSummaryCount + preCompactionKeptCount));
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
    const preCompactionKeptWindow = createReplaySlice(preCompactionEntries, replayMatch.preCompactionKept.messages, actualPreCompactionKeptWindow);
    const postCompactionTail = createReplaySlice(postCompactionEntries, contextPostCompactionTailMessages, contextPostCompactionTail);
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
export function buildNativeReplaySegments(args) {
    return buildNativeReplaySegmentsInternal(args);
}
export function rewriteResponsesPayloadWithNativeReplay(args) {
    return buildNativeReplaySegmentsInternal(args);
}
export { collectReplayMessages } from "./native-replay-matching.js";
