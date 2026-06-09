import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CustomMessageEntry } from "@earendil-works/pi-coding-agent";
import { NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE } from "../compaction/types.ts";

const ADAPTER_CONTEXT_EXCLUDED_CUSTOM_MESSAGE_TYPES = new Set([
	NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE,
]);

export function isAdapterContextExcludedCustomMessage(message: Pick<AgentMessage, "role"> & { customType?: string | undefined }): boolean {
	return message.role === "custom" && typeof message.customType === "string" && ADAPTER_CONTEXT_EXCLUDED_CUSTOM_MESSAGE_TYPES.has(message.customType);
}

export function isAdapterContextExcludedCustomMessageEntry(entry: CustomMessageEntry): boolean {
	return ADAPTER_CONTEXT_EXCLUDED_CUSTOM_MESSAGE_TYPES.has(entry.customType);
}
