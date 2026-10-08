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
	| "identity"
	| "reminder"
	| "urgent"
	| "fallback";

export interface ContextWindowIdentity {
	agentName?: string | undefined;
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
		agentName?: string | undefined;
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

const CONTEXT_WINDOW_GUIDANCE = `<context_window_guidance>
Keep one checkpoint per task at a stable path: request, constraints, decisions, progress, next steps, history IDs. Replace stale state; mark completion in place. Keep reusable findings and deferred ideas in separate topic notes; link, don't copy. Recording isn't permission to implement.

Save changed state after substantial work, before replying, and before new_context or handoff. Skip routine or unchanged state. Include checkpoint paths in handoffs. After rollover, read the checkpoint, then linked notes as needed; history only for missing details.
</context_window_guidance>`;

export function rewriteContextWindowGuidance(content: string): string {
	return content.replace(/^<context_window_guidance>[\s\S]*?<\/context_window_guidance>/,
		CONTEXT_WINDOW_GUIDANCE);
}

export function renderContextWindowMessage(
	identity: ContextWindowIdentity,
	threadHint?: string,
	agentName = "/root",
): string {
	const lines = [
		"<context_window>",
		`Agent name: ${agentName}`,
		`First context window id: ${identity.firstWindowId}`,
		`Current context window id: ${identity.currentWindowId}`,
	];
	if (identity.previousWindowId)
		lines.push(`Previous context window id: ${identity.previousWindowId}`);
	if (threadHint) lines.push(threadHint, "More notes may be available; list or search notes");
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
Context checkpoint requested. Save the current state with notes, then finish your response. The new window opens after this run settles. Do not call new_context. If saving fails, report the failure without rolling over.
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
			record["kind"] === "identity" ||
			record["kind"] === "reminder" ||
			record["kind"] === "urgent" ||
			record["kind"] === "fallback") &&
		(record["agentName"] === undefined || typeof record["agentName"] === "string") &&
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
