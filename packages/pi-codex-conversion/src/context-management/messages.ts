import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CodexDeveloperMessageDetails } from "../developer-messages.ts";

export const CODEX_CONTEXT_WINDOW_MESSAGE_TYPE = "codex-context-window";
export const CONTEXT_WINDOW_COMPACTION_SUMMARY =
	"[Pi Codex context-window boundary; no conversation summary was generated.]";
export const CONTEXT_WINDOW_COMPACTION_STRATEGY =
	"codex-context-window";

export const CONTEXT_WINDOW_REMINDER_THRESHOLD = 6_144;
export const CONTEXT_WINDOW_FALLBACK_BUFFER = 16_384;

export type ContextManagementMessageKind =
	| "window"
	| "reminder"
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
		windowNumber: number;
	};
}

export interface ContextWindowCompactionDetails {
	protocol: 1;
	strategy: typeof CONTEXT_WINDOW_COMPACTION_STRATEGY;
	windowId?: string | undefined;
}

const CONTEXT_WINDOW_GUIDANCE = `<context_window_guidance>
For work that may span context windows, use notes to maintain a concise checkpoint with the goal, decisions, progress, learnings and next steps. If notes are unavailable, checkpoint in durable Notebook state or a workspace file. get_context_remaining reports the current budget. Before new_context, save what the next window needs because no conversation summary is carried forward. When Previous context window id is present, read the checkpoint and use history to recover any missing detail. Treat this bookkeeping as private and do not mention it to the user.
</context_window_guidance>`;

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

export function renderContextWindowReminder(remainingTokens: number): string {
	return `<context_window_reminder>
Your current context window is nearly exhausted; only ${Math.max(0, Math.floor(remainingTokens))} tokens remain. Save a concise checkpoint with notes, then call new_context to continue in a fresh window. The next window will not automatically include this conversation.
</context_window_reminder>`;
}

export const CONTEXT_WINDOW_FALLBACK_MESSAGE = `<context_window_reminder>
The current context window is exhausted. Do not continue the task or give a final answer in this window. Make exactly one notes write or append call to save a concise checkpoint with the goal, decisions, progress, learnings and next steps, then call new_context. Do not use other tools before starting the new window.
</context_window_reminder>`;

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
			record["kind"] === "fallback") &&
		typeof record["firstWindowId"] === "string" &&
		record["firstWindowId"] !== "" &&
		typeof record["currentWindowId"] === "string" &&
		record["currentWindowId"] !== "" &&
		(record["previousWindowId"] === undefined ||
			typeof record["previousWindowId"] === "string") &&
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
