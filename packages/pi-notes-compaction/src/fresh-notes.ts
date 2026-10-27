import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import {
	buildSessionProjection,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { NOTE_RECEIPT, type NoteReceipt, noteReceipt } from "./notes.js";

export const NESTED_NOTE_OUTCOME = "notes-compaction:nested-write:v1";
export interface NestedNoteOutcome {
	protocol: 1;
	runId: string;
	windowId: string;
	callId: string;
	parentCallId: string;
	saved: boolean;
	origin?: "routed";
}
export const NOTES_RUN_ENTRY = "notes-compaction:run:v1";

/** A receipt proves persistence. Current-run tool outcomes prove the checkpoint actually completed. */
export function hasFreshNotes(
	branch: readonly SessionEntry[],
	windowId: string | undefined,
	runId?: string,
): boolean {
	const { messages, receipts, outcomes } = noteEvidence(
		branch,
		windowId,
		runId,
	);
	const final = messages.findLast((message) => message.role === "assistant");
	if (
		final?.role !== "assistant" ||
		final.stopReason !== "stop" ||
		final.content.some((block) => block.type === "toolCall")
	)
		return false;
	return completedWrites(
		messages.flatMap((message) =>
			message.role === "assistant"
				? message.content.filter((block) => block.type === "toolCall")
				: [],
		),
		messages.flatMap((message) =>
			message.role === "toolResult" ? [message] : [],
		),
		receipts,
		outcomes,
		messages.flatMap((message) =>
			message.role === "toolResult" ? [message] : [],
		),
	);
}

/** The current request is already in history; only its preceding completed invocation qualifies. */
export function hasPrecedingNoteWrite(
	branch: readonly SessionEntry[],
	windowId: string | undefined,
	runId: string,
	requestCallId: string,
): boolean {
	const { messages, receipts, outcomes } = noteEvidence(
		branch,
		windowId,
		runId,
	);
	const request = messages.findLastIndex(
		(message) =>
			message.role === "assistant" &&
			message.content.some(
				(block) => block.type === "toolCall" && block.id === requestCallId,
			),
	);
	if (request < 0) return false;
	const calls = messages
		.slice(0, request + 1)
		.flatMap((message) =>
			message.role === "assistant"
				? message.content.filter((block) => block.type === "toolCall")
				: [],
		);
	const call =
		calls[calls.findLastIndex((call) => call.id === requestCallId) - 1];
	if (!call) return false;
	const previous = messages.findLast(
		(message) =>
			message.role === "toolResult" &&
			message.toolCallId === call.id &&
			message.toolName === call.name,
	);
	return (
		previous?.role === "toolResult" &&
		completedWrites(
			[call],
			[previous],
			receipts,
			outcomes,
			messages.flatMap((message) =>
				message.role === "toolResult" ? [message] : [],
			),
		)
	);
}

function noteEvidence(
	branch: readonly SessionEntry[],
	windowId: string | undefined,
	runId?: string,
) {
	const lastUser = branch.findLastIndex(
		(entry) => entry.type === "message" && entry.message.role === "user",
	);
	const lastMessage = branch.findLastIndex(
		(entry) =>
			entry.type === "custom_message" ||
			(entry.type === "message" && entry.message.role !== "system"),
	);
	// Custom kickoffs have no user message. Scope both receipts and tool outcomes
	// to their native preparation boundary, not an earlier custom-only run.
	// /tree returns to a prompt's parent, which can include its preparation marker
	// without the prompt. Only a delivered message starts a new historical run.
	const runStart = branch.findLastIndex(
		(entry, index) =>
			entry.type === "custom" &&
			entry.customType === NOTES_RUN_ENTRY &&
			entry.data &&
			typeof entry.data === "object" &&
			"runId" in entry.data &&
			(runId ? entry.data.runId === runId : index < lastMessage),
	);
	const run = branch.slice(Math.max(lastUser, runStart) + 1);
	const receipts = run
		.filter(
			(entry) => entry.type === "custom" && entry.customType === NOTE_RECEIPT,
		)
		.flatMap((entry) =>
			entry.type === "custom" ? [noteReceipt(entry.data)] : [],
		)
		.filter((receipt): receipt is NoteReceipt =>
			Boolean(
				receipt &&
					receipt.origin !== "routed" &&
					receipt.windowId === windowId &&
					(!runId || receipt.runId === runId),
			),
		);
	const messages = buildSessionProjection(run).messages;
	const outcomes = run.flatMap((entry) => {
		if (entry.type !== "custom" || entry.customType !== NESTED_NOTE_OUTCOME)
			return [];
		const value = entry.data as Partial<NestedNoteOutcome> | undefined;
		return value?.protocol === 1 &&
			value.windowId === windowId &&
			(!runId || value.runId === runId) &&
			typeof value.callId === "string" &&
			typeof value.parentCallId === "string" &&
			(value.origin === undefined || value.origin === "routed") &&
			typeof value.saved === "boolean"
			? [value as NestedNoteOutcome]
			: [];
	});
	return { messages, receipts, outcomes };
}

function completedWrites(
	calls: readonly ToolCall[],
	results: readonly ToolResultMessage[],
	receipts: readonly NoteReceipt[],
	outcomes: readonly NestedNoteOutcome[],
	allResults: readonly ToolResultMessage[],
): boolean {
	if (!receipts.length) return false;
	const writes = calls.filter(
		(call) =>
			call.name === "notes" &&
			(call.arguments["action"] === "write_file" ||
				call.arguments["action"] === "append_to_file"),
	);
	let completedWrite = false;
	for (const call of writes) {
		const result = results.find(
			(result) =>
				result.toolCallId === call.id && result.toolName === call.name,
		);
		if (
			result?.details &&
			typeof result.details === "object" &&
			"notesCompactionRouted" in result.details &&
			result.details["notesCompactionRouted"] === true
		)
			continue;
		if (
			!result ||
			result.isError ||
			!result.details ||
			typeof result.details !== "object" ||
			!("notesCompaction" in result.details)
		)
			return false;
		const details = result.details["notesCompaction"];
		if (
			!details ||
			typeof details !== "object" ||
			!("protocol" in details) ||
			details["protocol"] !== 1 ||
			!("saved" in details) ||
			details["saved"] !== true ||
			!("runId" in details) ||
			!receipts.some((receipt) => receipt?.runId === details["runId"])
		)
			return false;
		completedWrite = true;
	}
	for (const result of results) {
		const cell = codeCell(result);
		const terminal = cell
			? allResults.findLast(
					(item) =>
						codeCell(item)?.id === cell.id &&
						codeCell(item)?.status !== "yielded",
				)
			: undefined;
		const parents = new Set(
			allResults
				.filter((item) => cell && codeCell(item)?.id === cell.id)
				.map((item) => item.toolCallId),
		);
		parents.add(result.toolCallId);
		const completed = outcomes.filter((item) => parents.has(item.parentCallId));
		const local = completed.filter((item) => item.origin !== "routed");
		if (local.length) {
			if (local.some((item) => !item.saved)) return false;
			if (
				result.isError ||
				(cell &&
					(!terminal ||
						terminal.isError ||
						codeCell(terminal)?.status !== "result" ||
						codeCell(terminal)?.failed))
			)
				return false;
			completedWrite = true;
		}
		// Older saved PCC runs used a note-specific completion field. Read it,
		// but new executions rely on Notes-owned outcomes and public Pi events.
		const legacy =
			result.details &&
			typeof result.details === "object" &&
			"contextNotesSaved" in result.details
				? result.details["contextNotesSaved"]
				: undefined;
		if (!completed.length && legacy !== undefined) {
			if (
				legacy === false ||
				result.isError ||
				(cell &&
					(!terminal ||
						codeCell(terminal)?.status !== "result" ||
						codeCell(terminal)?.failed))
			)
				return false;
			if (legacy === true) completedWrite = true;
		}
		const nested = result.nestedCalls;
		const noteCalls =
			nested?.calls.filter((call) => call.name === "notes") ?? [];
		const uncovered =
			legacy === true && !completed.length
				? []
				: noteCalls.filter(
						(call) => !outcomes.some((item) => item.callId === call.id),
					);
		if (
			uncovered.some(
				(call) =>
					call.status !== "ok" &&
					(!call.arguments ||
						call.arguments["action"] === "write_file" ||
						call.arguments["action"] === "append_to_file"),
			) ||
			(uncovered.length && !nested?.complete)
		)
			return false;
		const nestedWrites = uncovered.filter(
			(call) =>
				call.arguments?.["action"] === "write_file" ||
				call.arguments?.["action"] === "append_to_file",
		);
		if (
			nestedWrites.some((call) => call.status !== "ok") ||
			(nestedWrites.length && (result.isError || !nested?.complete))
		)
			return false;
		if (nestedWrites.length) completedWrite = true;
	}
	return completedWrite;
}

function codeCell(
	result: ToolResultMessage,
): { id: string; status: unknown; failed: boolean } | undefined {
	const details = result.details;
	if (
		!details ||
		typeof details !== "object" ||
		!("codeMode" in details) ||
		details["codeMode"] !== true ||
		!("cellId" in details) ||
		typeof details["cellId"] !== "string" ||
		!("status" in details)
	)
		return;
	return {
		id: details["cellId"],
		status: details["status"],
		failed: "scriptError" in details && Boolean(details["scriptError"]),
	};
}
