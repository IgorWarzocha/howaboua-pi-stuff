import { serializeMessagesToResponsesInput } from "../compaction/serializer.js";
import { areEquivalentValues, cloneResponsesInputSlice } from "./payload-structured.js";
import { toPiReplayAgentMessage, toReplayAgentMessage } from "./replay-message-conversion.js";
export function collectReplayMessages(entries) {
    const messages = [];
    for (const entry of entries) {
        const message = toReplayAgentMessage(entry);
        if (message) {
            messages.push(message);
        }
    }
    return messages;
}
function collectPiReplayMessages(entries) {
    const messages = [];
    for (const entry of entries) {
        const message = toPiReplayAgentMessage(entry);
        if (message)
            messages.push(message);
    }
    return messages;
}
export function createCompactionSummaryAgentMessage(entry) {
    return {
        role: "compactionSummary",
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
        timestamp: new Date(entry.timestamp).getTime(),
    };
}
export function createReplaySlice(entries, messages, input) {
    return {
        entries: [...entries],
        messages: [...messages],
        input: [...input],
    };
}
function createReplayMessageSet(model, messages) {
    return {
        messages,
        input: serializeMessagesToResponsesInput(model, messages),
    };
}
function createReplayVariants(args) {
    const contextMessages = collectReplayMessages(args.entries);
    const piMessages = collectPiReplayMessages(args.entries);
    const contextSet = createReplayMessageSet(args.model, contextMessages);
    if (areEquivalentValues(contextMessages, piMessages))
        return [contextSet];
    return [contextSet, createReplayMessageSet(args.model, piMessages)];
}
function clonePayloadConversationInput(args) {
    const tailEndIndex = args.payloadInput.length - args.freshPreamble.trailingInput.length;
    if (tailEndIndex < args.freshPreamble.leadingInput.length)
        return undefined;
    return cloneResponsesInputSlice(args.payloadInput.slice(args.freshPreamble.leadingInput.length, tailEndIndex));
}
function stripLeadingCompactionSummaryPlaceholder(args) {
    if (args.compactionSummaryInput.length === 0)
        return [...args.conversationInput];
    if (!areEquivalentValues(args.conversationInput.slice(0, args.compactionSummaryInput.length), args.compactionSummaryInput)) {
        return [...args.conversationInput];
    }
    return [...args.conversationInput.slice(args.compactionSummaryInput.length)];
}
export function buildLenientNativeReplayPayload(args) {
    const conversationInput = clonePayloadConversationInput({ payloadInput: args.payload.input, freshPreamble: args.freshPreamble });
    if (!conversationInput)
        return undefined;
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
export function findReplayMatch(args) {
    const compactionSummaryInput = serializeMessagesToResponsesInput(args.model, [args.compactionSummaryMessage]);
    const preCompactionVariants = [
        ...createReplayVariants({ model: args.model, entries: args.preCompactionEntries }),
        createReplayMessageSet(args.model, []),
    ];
    const postCompactionVariants = createReplayVariants({ model: args.model, entries: args.postCompactionEntries });
    for (const preCompactionKept of preCompactionVariants) {
        for (const postCompactionTail of postCompactionVariants) {
            const expectedBeforeTrailing = [
                ...args.freshPreamble.leadingInput,
                ...compactionSummaryInput,
                ...preCompactionKept.input,
                ...postCompactionTail.input,
            ];
            const originalPiReplayInput = [...expectedBeforeTrailing, ...args.freshPreamble.trailingInput];
            const tailEndIndex = args.payloadInput.length - args.freshPreamble.trailingInput.length;
            const prefixMatches = areEquivalentValues(args.payloadInput.slice(0, expectedBeforeTrailing.length), expectedBeforeTrailing);
            const trailingMatches = areEquivalentValues(args.payloadInput.slice(tailEndIndex), args.freshPreamble.trailingInput);
            if (prefixMatches && trailingMatches && tailEndIndex >= expectedBeforeTrailing.length) {
                const actualPostCompactionTail = cloneResponsesInputSlice(args.payloadInput.slice(args.freshPreamble.leadingInput.length + compactionSummaryInput.length + preCompactionKept.input.length, tailEndIndex));
                const extraPostCompactionTail = cloneResponsesInputSlice(args.payloadInput.slice(expectedBeforeTrailing.length, tailEndIndex));
                if (!actualPostCompactionTail || !extraPostCompactionTail)
                    return undefined;
                return { originalPiReplayInput, preCompactionKept, postCompactionTail, actualPostCompactionTail, extraPostCompactionTail };
            }
        }
    }
    return undefined;
}
