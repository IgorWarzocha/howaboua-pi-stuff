import { buildSessionProjection, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { CODEX_CONTEXT_WINDOW_MESSAGE_TYPE, isCodexContextManagementMessageDetails } from "./messages.ts";

/** Check the selected conversation, not a process-local recollection of a tool execution. */
export function hasFreshContextNotes(
	branch: readonly SessionEntry[],
	windowId: string,
	mode: ContextManagementMode,
	requireFinalReply: boolean,
): boolean {
	if (mode === "off") return false;
	const boundary = branch.findLastIndex((entry) => entry.type === "custom_message" &&
		entry.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
		isCodexContextManagementMessageDetails(entry.details) &&
		entry.details.contextManagement.kind === "window");
	const entry = branch[boundary];
	if (entry?.type !== "custom_message" || !isCodexContextManagementMessageDetails(entry.details) ||
		entry.details.contextManagement.currentWindowId !== windowId) return false;
	// Pi owns context edits and compaction selection. Metadata never counts as new work.
	const messages = buildSessionProjection(branch.slice(boundary + 1)).messages;
	const results = new Set<string>();
	let finalReply = false;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index]!;
		if (message.role === "system") continue;
		if (message.role === "assistant") {
			if (message.stopReason !== "stop" && message.stopReason !== "toolUse") return false;
			const calls = message.content.filter((part) => part.type === "toolCall");
			if (calls.length === 0) {
				if (message.stopReason !== "stop") return false;
				finalReply = true;
				continue;
			}
			// A mixed or unfinished batch can contain work not covered by the saved note.
			return (!requireFinalReply || finalReply) && calls.length === results.size &&
				calls.every((call) => call.name === "notes" && results.has(call.id) &&
					(call.arguments["action"] === "write_file" || call.arguments["action"] === "append_to_file"));
		}
		if (message.role !== "toolResult" || message.toolName !== "notes" || message.isError ||
			(requireFinalReply && !finalReply)) return false;
		const details = message.details;
		if (!details || typeof details !== "object" || !("codexHistoryNotes" in details)) return false;
		const result = details["codexHistoryNotes"];
		if (!result || typeof result !== "object" ||
			(mode === "remote"
				? !("encrypted_output" in result && typeof result["encrypted_output"] === "string")
				: !("source" in result && result["source"] === "pi-session"))) return false;
		if (results.has(message.toolCallId)) return false;
		results.add(message.toolCallId);
	}
	return false;
}
