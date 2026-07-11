import { NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE } from "../compaction/types.js";
const ADAPTER_CONTEXT_EXCLUDED_CUSTOM_MESSAGE_TYPES = new Set([
    NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE,
]);
export function isAdapterContextExcludedCustomMessage(message) {
    return message.role === "custom" && typeof message.customType === "string" && ADAPTER_CONTEXT_EXCLUDED_CUSTOM_MESSAGE_TYPES.has(message.customType);
}
export function isAdapterContextExcludedCustomMessageEntry(entry) {
    return ADAPTER_CONTEXT_EXCLUDED_CUSTOM_MESSAGE_TYPES.has(entry.customType);
}
