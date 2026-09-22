import { randomUUID } from "node:crypto";
import type { CustomMessageEntryDraft } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CodexDeveloperMessageDetails } from "../developer-messages.ts";

export const CODEX_CONTEXT_WINDOW_MESSAGE_TYPE = "codex-context-window";
export const CONTEXT_WINDOW_COMPACTION_SUMMARY =
	"[Pi Codex context-window boundary; no conversation summary was generated.]";
export const CONTEXT_WINDOW_COMPACTION_STRATEGY =
	"codex-context-window";

export const CONTEXT_WINDOW_REMINDER_PERCENT = 85;
export const CONTEXT_WINDOW_URGENT_PERCENT = 90;

export type ContextManagementMessageKind =
	| "window"
	| "reminder"
	| "urgent"
	| "fallback";

export interface ContextWindowIdentity {
	firstWindowId: string;
	currentWindowId: string;
	previousWindowId?: string | undefined;
	windowNumber: number;
}

export interface CodexContextManagementMessageDetails
	extends CodexDeveloperMessageDetails {
	contextManagement: {
		protocol: 1;
		kind: ContextManagementMessageKind;
		firstWindowId: string;
		currentWindowId: string;
		previousWindowId?: string | undefined;
		trimPreviousWindow?: true | undefined;
		windowNumber: number;
	};
}

export interface ContextWindowCompactionDetails {
	protocol: 1;
	strategy: typeof CONTEXT_WINDOW_COMPACTION_STRATEGY;
	windowId?: string | undefined;
}

const CONTEXT_WINDOW_BACKLOG_GUIDANCE = "Keep deferred ideas and tasks—including those unrelated to the current work—in notes for later resumption. Update them as decisions change; recording is not permission to implement.";

const CONTEXT_WINDOW_GUIDANCE = `<context_window_guidance>
Checkpoint the active request, known history IDs, decisions, progress, learnings and next steps in notes before new_context. After rollover, read hinted notes. Use history only for a missing detail.
${CONTEXT_WINDOW_BACKLOG_GUIDANCE}
</context_window_guidance>`;

const CONTEXT_WINDOW_EXPLICIT_GUIDANCE = `<context_window_guidance>
Notes persist across windows; history retrieves earlier conversation. Update existing notes with task state, decisions and next steps before new_context. After rollover, read hinted notes and resume; consult history only for missing details. Save enough in notes to resume the task without rereading the conversation.
${CONTEXT_WINDOW_BACKLOG_GUIDANCE}
</context_window_guidance>`;

export function rewriteContextWindowGuidance(content: string, astra: boolean): string {
	return content.replace(/^<context_window_guidance>[\s\S]*?<\/context_window_guidance>/,
		astra ? CONTEXT_WINDOW_GUIDANCE : CONTEXT_WINDOW_EXPLICIT_GUIDANCE);
}

export function renderContextWindowMessage(
	identity: ContextWindowIdentity,
	threadHint?: string,
): string {
	const lines = [
		"<context_window>",
		"Agent name: /root",
		`First context window id: ${identity.firstWindowId}`,
		`Current context window id: ${identity.currentWindowId}`,
	];
	if (identity.previousWindowId)
		lines.push(`Previous context window id: ${identity.previousWindowId}`);
	if (threadHint) lines.push(threadHint);
	lines.push("</context_window>");
	return `${CONTEXT_WINDOW_GUIDANCE}\n\n${lines.join("\n")}`;
}

export function renderContextWindowReminder(remainingPercent: number, urgent: boolean): string {
	return `<context_window_reminder>
${urgent ? "Urgent: " : ""}${remainingPercent}% remaining. Checkpoint the active request, state and known history IDs in notes, then call new_context ${urgent ? "now, before other work" : "before continuing work"}.
</context_window_reminder>`;
}

export function renderManualContextCheckpoint(customInstructions?: string): string {
	return `<context_window_reminder>
Manual context rollover requested. If you haven't just created or appended a note covering the current state, save it with notes. Then call new_context immediately, before other work. If saving fails, report the failure without rolling over.
</context_window_reminder>${customInstructions?.trim() ? `\n\nCheckpoint guidance from /compact:\n${customInstructions}` : ""}`;
}

export function isCodexContextManagementMessageDetails(
	value: unknown,
): value is CodexContextManagementMessageDetails {
	if (!value || typeof value !== "object") return false;
	const details = value as Record<string, unknown>;
	if (
		details["protocol"] !== 1 ||
		typeof details["id"] !== "string" ||
		!details["id"]
	)
		return false;
	const context = details["contextManagement"];
	if (!context || typeof context !== "object") return false;
	const record = context as Record<string, unknown>;
	return (
		record["protocol"] === 1 &&
		(record["kind"] === "window" ||
			record["kind"] === "reminder" ||
			record["kind"] === "urgent" ||
			record["kind"] === "fallback") &&
		typeof record["firstWindowId"] === "string" &&
		record["firstWindowId"] !== "" &&
		typeof record["currentWindowId"] === "string" &&
		record["currentWindowId"] !== "" &&
		(record["previousWindowId"] === undefined ||
			typeof record["previousWindowId"] === "string") &&
		(record["trimPreviousWindow"] === undefined ||
			record["trimPreviousWindow"] === true) &&
		Number.isInteger(record["windowNumber"]) &&
		(record["windowNumber"] as number) >= 0
	);
}

export function isContextWindowBoundary(
	message: AgentMessage,
): message is Extract<AgentMessage, { role: "custom" }> & {
	details: CodexContextManagementMessageDetails;
} {
	return (
		message.role === "custom" &&
		message.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
		isCodexContextManagementMessageDetails(message.details) &&
		message.details.contextManagement.kind === "window"
	);
}

export function isContextWindowCompactionDetails(
	value: unknown,
): value is ContextWindowCompactionDetails {
	return Boolean(
		value &&
			typeof value === "object" &&
			"protocol" in value &&
			value.protocol === 1 &&
			"strategy" in value &&
			value.strategy === CONTEXT_WINDOW_COMPACTION_STRATEGY,
	);
}

export function createContextWindowMessage(
	content: string,
	kind: ContextManagementMessageKind,
	identity: ContextWindowIdentity,
	trimPreviousWindow = false,
): CustomMessageEntryDraft & { details: CodexContextManagementMessageDetails } {
	return {
		type: "custom_message",
		customType: CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
		content,
		display: true,
		details: {
			protocol: 1,
			id: randomUUID(),
			contextManagement: {
				protocol: 1,
				kind,
				...identity,
				...(trimPreviousWindow ? { trimPreviousWindow: true as const } : {}),
			},
		},
	};
}
