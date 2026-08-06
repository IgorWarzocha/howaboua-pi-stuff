import type { CustomMessageEntry } from "@earendil-works/pi-coding-agent";
import { isVoiceContextExcludedMessage } from "../../voice/context-visibility.ts";
import { NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE } from "../compaction/types.ts";

const ADAPTER_CONTEXT_EXCLUDED_CUSTOM_MESSAGE_TYPES = new Set([
	NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE,
]);

export function isProviderContextExcludedMessage(message: {
	role: string;
	customType?: string | undefined;
	content?: unknown;
}): boolean {
	return isVoiceContextExcludedMessage(message)
		|| (message.role === "custom" && typeof message.customType === "string" && ADAPTER_CONTEXT_EXCLUDED_CUSTOM_MESSAGE_TYPES.has(message.customType));
}

export function isProviderContextExcludedCustomMessageEntry(entry: CustomMessageEntry): boolean {
	return isProviderContextExcludedMessage({
		role: "custom",
		customType: entry.customType,
		content: entry.content,
	});
}
