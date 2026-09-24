import type { AgentMessage } from "@earendil-works/pi-agent-core";
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
	const results = new Map<string, Extract<AgentMessage, { role: "toolResult" }>>();
	let atEnd = true;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index]!;
		if (message.role === "system") continue;
		if (atEnd) {
			atEnd = false;
			if (message.role === "assistant" && message.stopReason === "stop" &&
				!message.content.some((part) => part.type === "toolCall")) continue;
			if (requireFinalReply) return false;
		}
		if (message.role === "assistant") {
			if (message.stopReason !== "stop" && message.stopReason !== "toolUse") return false;
			const calls = message.content.filter((part) => part.type === "toolCall");
			// A previous final reply ends the run. Within it, completed tool batches do not stale notes.
			if (calls.length === 0 || calls.length !== results.size ||
				calls.some((call) => results.get(call.id)?.toolName !== call.name)) return false;
			const writes = calls.filter((call) => call.name === "notes" &&
				(call.arguments["action"] === "write_file" || call.arguments["action"] === "append_to_file"));
			if (writes.length > 0) return writes.every((call) => {
				const result = results.get(call.id)!;
				if (result.isError) return false;
				const details = result.details;
				if (!details || typeof details !== "object" || !("codexHistoryNotes" in details)) return false;
				const note = details["codexHistoryNotes"];
				return !!note && typeof note === "object" &&
					(mode === "remote"
						? "encrypted_output" in note && typeof note["encrypted_output"] === "string"
						: "source" in note && note["source"] === "pi-session");
			});
			results.clear();
			continue;
		}
		if (message.role !== "toolResult" || results.has(message.toolCallId)) return false;
		results.set(message.toolCallId, message);
	}
	return false;
}
