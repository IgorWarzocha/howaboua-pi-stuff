import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildSessionProjection, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { CODEX_CONTEXT_WINDOW_MESSAGE_TYPE, isCodexContextManagementMessageDetails } from "./messages.ts";
import { REMOTE_DELIVERY_MESSAGE, readRemoteDelivery, remoteDeliverySource, type RemoteDelivery } from "./remote-delivery.ts";

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
	const deliveries = new Map<string, RemoteDelivery>();
	let atEnd = true;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index]!;
		if (message.role === "system") continue;
		if (message.role === "custom" && message.customType === REMOTE_DELIVERY_MESSAGE) {
			let delivery: RemoteDelivery;
			try { delivery = readRemoteDelivery(message.details); } catch { return false; }
			if (deliveries.has(delivery.sourceCallId)) return false;
			deliveries.set(delivery.sourceCallId, delivery);
			continue;
		}
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
			const writes = calls.filter((call) => call.name === "notes"
				? call.arguments["action"] === "write_file" || call.arguments["action"] === "append_to_file"
				: (call.name === "exec" || call.name === "wait") && nestedNoteWrite(results.get(call.id)!) !== undefined);
			if (writes.length > 0) return writes.every((call) => {
				const result = results.get(call.id)!;
				if (result.isError) return false;
				if (call.name !== "notes") return nestedNoteWrite(result) === true &&
					(mode !== "remote" || remoteNoteWrite(result, deliveries.get(call.id), messages, index, branch));
				const details = result.details;
				if (!details || typeof details !== "object" || !("codexHistoryNotes" in details)) return false;
				const note = details["codexHistoryNotes"];
				return !!note && typeof note === "object" &&
					(mode === "remote"
						? "encrypted_output" in note && typeof note["encrypted_output"] === "string"
						: "source" in note && note["source"] === "pi-session");
			});
			results.clear();
			deliveries.clear();
			continue;
		}
		if (message.role !== "toolResult" || results.has(message.toolCallId)) return false;
		results.set(message.toolCallId, message);
	}
	return false;
}

function remoteNoteWrite(result: Extract<AgentMessage, { role: "toolResult" }>, delivery: RemoteDelivery | undefined,
	messages: readonly AgentMessage[], callIndex: number, branch: readonly SessionEntry[]): boolean {
	const details = result.details;
	if (!details || typeof details !== "object" || !("contextNotesSource" in details) || details["contextNotesSource"] !== "remote") return false;
	// Pre-host-delivery sessions used native wait. Keep their selected history readable without rewriting it.
	if (!("opaqueDeliveryId" in details)) return result.toolName === "wait";
	if (delivery?.protocol === 2 && !hasCurrentProtectedOutput(delivery, messages, callIndex, branch)) return false;
	return Boolean(delivery && details["opaqueDeliveryId"] === delivery.id &&
		"cellId" in details && details["cellId"] === delivery.cellId && "status" in details && details["status"] === "result" &&
		delivery.sourceCallId === result.toolCallId && delivery.status === "result" &&
		delivery.contextNotesSaved === true && !delivery.errorText && !("scriptError" in details));
}

function hasCurrentProtectedOutput(delivery: Extract<RemoteDelivery, { protocol: 2 }>, messages: readonly AgentMessage[],
	callIndex: number, branch: readonly SessionEntry[]): boolean {
	const start = messages.slice(0, callIndex).findLastIndex(message => message.role === "user" ||
		message.role === "assistant" && !message.content.some(part => part.type === "toolCall"));
	const run = messages.slice(start + 1);
	if (!run.some(message => message.role === "assistant" && message.content.some(part =>
		part.type === "toolCall" && part.name === "exec" && part.id === delivery.originalExecCallId))) return false;
	if (!run.some(message => message.role === "toolResult" && message.toolCallId === delivery.originalExecCallId &&
		message.toolName === "exec" && message.details && typeof message.details === "object" &&
		"codeMode" in message.details && message.details["codeMode"] === true &&
		"cellId" in message.details && message.details["cellId"] === delivery.cellId)) return false;
	const ctx = { sessionManager: {
		getEntries: () => [...branch],
		getBranch: (id?: string | null) => id ? branch.slice(0, branch.findIndex(entry => entry.id === id) + 1) : [...branch],
	} };
	try {
		remoteDeliverySource(delivery, ctx);
		return run.some(message => {
			if (message.role !== "custom" || message.customType !== REMOTE_DELIVERY_MESSAGE) return false;
			const protectedDelivery = readRemoteDelivery(message.details);
			if (protectedDelivery.protocol !== 2 || !protectedDelivery.outputs.length ||
				protectedDelivery.originalExecCallId !== delivery.originalExecCallId || protectedDelivery.cellId !== delivery.cellId ||
				protectedDelivery.scope !== delivery.scope) return false;
			if (!run.some(result => result.role === "toolResult" && result.toolCallId === protectedDelivery.sourceCallId &&
				result.details && typeof result.details === "object" && "opaqueDeliveryId" in result.details &&
				result.details["opaqueDeliveryId"] === protectedDelivery.id)) return false;
			remoteDeliverySource(protectedDelivery, ctx);
			return true;
		});
	} catch { return false; }
}

function nestedNoteWrite(result: Extract<AgentMessage, { role: "toolResult" }>): boolean | undefined {
	const details = result.details;
	return details && typeof details === "object" && "codeMode" in details && details["codeMode"] === true &&
		"contextNotesSaved" in details && typeof details["contextNotesSaved"] === "boolean"
		? details["contextNotesSaved"] : undefined;
}

