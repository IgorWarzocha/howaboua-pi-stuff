import { isAdapterContextExcludedCustomMessageEntry } from "../prompt/context-filter.js";
function toBranchSummaryMessage(entry) {
    return { role: "branchSummary", summary: entry.summary, fromId: entry.fromId, timestamp: new Date(entry.timestamp).getTime() };
}
function toCustomMessage(entry) {
    return { role: "custom", customType: entry.customType, content: entry.content, display: entry.display, details: entry.details, timestamp: new Date(entry.timestamp).getTime() };
}
function toSessionMessage(entry) {
    return entry.message;
}
export function toReplayAgentMessage(entry) {
    if (entry.type === "message")
        return toSessionMessage(entry);
    if (entry.type === "custom_message") {
        if (isAdapterContextExcludedCustomMessageEntry(entry))
            return undefined;
        return toCustomMessage(entry);
    }
    if (entry.type === "branch_summary")
        return toBranchSummaryMessage(entry);
    return undefined;
}
export function toPiReplayAgentMessage(entry) {
    if (entry.type === "message")
        return toSessionMessage(entry);
    if (entry.type === "custom_message")
        return toCustomMessage(entry);
    if (entry.type === "branch_summary")
        return toBranchSummaryMessage(entry);
    return undefined;
}
