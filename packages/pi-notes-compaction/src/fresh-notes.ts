import {
	buildSessionProjection,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { NOTE_RECEIPT, noteReceipt } from "./notes.js";

/** A receipt proves persistence. Current-run tool outcomes prove the checkpoint actually completed. */
export function hasFreshNotes(
	branch: readonly SessionEntry[],
	windowId: string | undefined,
	runId?: string,
): boolean {
	if (!windowId) return false;
	const lastUser = branch.findLastIndex(
		(entry) => entry.type === "message" && entry.message.role === "user",
	);
	const run = branch.slice(lastUser + 1);
	const receipts = run
		.filter(
			(entry) => entry.type === "custom" && entry.customType === NOTE_RECEIPT,
		)
		.flatMap((entry) =>
			entry.type === "custom" ? [noteReceipt(entry.data)] : [],
		)
		.filter(
			(receipt) =>
				receipt &&
				receipt.windowId === windowId &&
				(!runId || receipt.runId === runId),
		);
	if (!receipts.length) return false;
	const messages = buildSessionProjection(run).messages;
	const final = messages.findLast((message) => message.role === "assistant");
	if (
		final?.role !== "assistant" ||
		final.stopReason !== "stop" ||
		final.content.some((block) => block.type === "toolCall")
	)
		return false;
	const calls = messages.flatMap((message) =>
		message.role === "assistant"
			? message.content.filter((block) => block.type === "toolCall")
			: [],
	);
	const results = messages.flatMap((message) =>
		message.role === "toolResult" ? [message] : [],
	);
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
		const details = result.details;
		const saved =
			details && typeof details === "object" && "contextNotesSaved" in details
				? details["contextNotesSaved"]
				: undefined;
		// PCC's protected exec/wait host records cover nested calls outside Pi's executeTool path.
		if (saved === false || (saved === true && result.isError)) return false;
		if (
			saved === true &&
			(result.toolName === "exec" || result.toolName === "wait")
		)
			completedWrite = true;
		const nested = result.nestedCalls;
		const noteCalls =
			nested?.calls.filter((call) => call.name === "notes") ?? [];
		if (
			noteCalls.some(
				(call) =>
					call.status !== "ok" &&
					(!call.arguments ||
						call.arguments["action"] === "write_file" ||
						call.arguments["action"] === "append_to_file"),
			) ||
			(noteCalls.length && !nested?.complete)
		)
			return false;
		const nestedWrites =
			nested?.calls.filter(
				(call) =>
					call.name === "notes" &&
					(call.arguments?.["action"] === "write_file" ||
						call.arguments?.["action"] === "append_to_file"),
			) ?? [];
		if (
			nestedWrites.some((call) => call.status !== "ok") ||
			(nestedWrites.length && (result.isError || !nested?.complete))
		)
			return false;
		if (nestedWrites.length) completedWrite = true;
	}
	return completedWrite;
}
