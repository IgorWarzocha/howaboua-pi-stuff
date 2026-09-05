import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
Checkpoint the active request, known history IDs, decisions, progress, learnings and next steps in notes before new_context; no summary carries over. After rollover, read hinted notes. Use history only for a missing detail.
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
Only ${Math.max(0, Math.floor(remainingTokens))} context tokens remain. Checkpoint the active request, state and known history IDs in notes, then call new_context; no conversation summary carries over.
</context_window_reminder>`;
}

export const CONTEXT_WINDOW_FALLBACK_MESSAGE = `<context_window_reminder>
Context exhausted. Do not continue or answer. Make exactly one notes write or append call that checkpoints the active request, state and known history IDs, then call new_context. Use no other tools before rollover.
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

export function sendContextWindowMessage(
	pi: ExtensionAPI,
	content: string,
	kind: ContextManagementMessageKind,
	identity: ContextWindowIdentity,
	options: { triggerTurn: boolean },
	trimPreviousWindow = false,
): void {
	pi.sendMessage<CodexContextManagementMessageDetails>(
		{
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
					...(trimPreviousWindow
						? { trimPreviousWindow: true as const }
						: {}),
				},
			},
		},
		options.triggerTurn
			? { deliverAs: "steer", triggerTurn: true }
			: { triggerTurn: false },
	);
}
