import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { CODEX_DEVELOPER_MESSAGE_TYPE, isCodexDeveloperMessageDetails, type CodexDeveloperMessageDetails } from "../developer-messages.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import type { AdapterState } from "./activation/state.ts";

export const CODEX_NOTEBOOK_STATUS_TYPE = "codex-notebook-status";

interface NotebookStatus extends CodexDeveloperMessageDetails {
	content: string;
	title: string;
}

export function readNotebookStatus(value: unknown): NotebookStatus {
	if (!isCodexDeveloperMessageDetails(value) || !("content" in value) || typeof value.content !== "string"
		|| !value.content.trim() || !("title" in value) || typeof value.title !== "string" || !value.title.trim())
		throw new Error("Malformed persisted Notebook status");
	return value as NotebookStatus;
}

export function projectNotebookStatusEntry(entry: SessionEntry): SessionEntry {
	if (entry.type !== "custom" || entry.customType !== CODEX_NOTEBOOK_STATUS_TYPE) return entry;
	const status = readNotebookStatus(entry.data);
	return { ...entry, type: "custom_message", content: status.content, display: false, details: status };
}

/** A status sample belongs to this runtime lifecycle, and is reusable only while visible. */
export async function recordNotebookStatus(
	pi: Pick<ExtensionAPI, "appendEntry">,
	ctx: ExtensionContext,
	state: Pick<AdapterState, "notebookStatusMessageId">,
	messages: readonly AgentMessage[],
	codeMode: Pick<CodeModeRegistration, "notebookStatus">,
): Promise<boolean> {
	if (state.notebookStatusMessageId && messages.some((message) => message.role === "custom"
		&& (message.customType === CODEX_NOTEBOOK_STATUS_TYPE || message.customType === CODEX_DEVELOPER_MESSAGE_TYPE)
		&& isCodexDeveloperMessageDetails(message.details) && message.details.id === state.notebookStatusMessageId)) return false;
	let content: string;
	let title: string;
	try {
		const status = await codeMode.notebookStatus(ctx);
		content = status.message;
		title = [
			"Notebook",
			typeof status.details["retainedBindings"] === "number" ? `${status.details["retainedBindings"]} retained` : undefined,
			typeof status.details["pinnedBindings"] === "number" ? `${status.details["pinnedBindings"]} pinned` : undefined,
		].filter(Boolean).join(" · ");
	} catch (error) {
		if (ctx.signal?.aborted) throw error;
		title = "Notebook status unavailable";
		content = `Notebook startup status unavailable: ${error instanceof Error ? error.message : String(error)}\nUse notebook diagnostics to inspect the failure before relying on retained state`;
	}
	ctx.signal?.throwIfAborted();
	const status: NotebookStatus = { protocol: 1, id: randomUUID(), content, title };
	// Durable at admission even during a live run; entry rendering owns the same UI notice.
	pi.appendEntry(CODEX_NOTEBOOK_STATUS_TYPE, status);
	state.notebookStatusMessageId = status.id;
	return true;
}
