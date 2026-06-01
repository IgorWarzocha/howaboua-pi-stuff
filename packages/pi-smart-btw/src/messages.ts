import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LEGACY_MESSAGE_TYPE, MESSAGE_TYPE } from "./constants.js";
import type { BtwSession, BtwTurn } from "./types.js";

export type BtwMessageDetails = {
	kind: "result" | "cleared";
	label?: string;
	slot: number;
	generation: string;
	turn?: number;
	question?: string;
	answer?: string;
	error?: string;
	startedAt?: number;
	finishedAt?: number;
	clearedAt?: number;
};

function messageRoleType(message: {
	role?: string;
	type?: string;
}): string | undefined {
	return message.role ?? message.type;
}

export function isBtwResultMessage(message: {
	role?: string;
	type?: string;
	customType?: string;
	details?: unknown;
}): boolean {
	const role = messageRoleType(message);
	if (role !== "custom" && role !== "custom_message") return false;
	const customType = String(message.customType ?? "");
	if (customType === MESSAGE_TYPE || customType === LEGACY_MESSAGE_TYPE)
		return true;
	if (customType.startsWith(`${MESSAGE_TYPE} `)) return true;
	return false;
}

export function isBtwContextMessage(message: {
	role?: string;
	type?: string;
	customType?: string;
	details?: unknown;
}): boolean {
	return isBtwResultMessage(message);
}

function getResultLabel(session: BtwSession, turn: BtwTurn) {
	const turnIndex = turn.turnIndex ?? session.turns.indexOf(turn) + 1;
	return `${MESSAGE_TYPE} ${session.index + 1}-${turnIndex}`;
}

function getClearedLabel(session: BtwSession) {
	return `${MESSAGE_TYPE} ${session.index + 1} CLEARED`;
}

export function sendResultMessage(
	pi: ExtensionAPI,
	session: BtwSession,
	turn: BtwTurn,
) {
	const label = getResultLabel(session, turn);
	pi.sendMessage({
		customType: MESSAGE_TYPE,
		content: turn.answer || turn.error || "(no answer)",
		display: true,
		details: {
			kind: "result",
			label,
			slot: session.index + 1,
			generation: session.generationId,
			turn: turn.turnIndex ?? session.turns.indexOf(turn) + 1,
			question: turn.question,
			answer: turn.answer,
			error: turn.error,
			startedAt: turn.startedAt,
			finishedAt: turn.finishedAt,
		},
	});
}

export function sendClearedMessage(pi: ExtensionAPI, session: BtwSession) {
	pi.sendMessage({
		customType: MESSAGE_TYPE,
		content: "cleared",
		display: false,
		details: {
			kind: "cleared",
			label: getClearedLabel(session),
			slot: session.index + 1,
			generation: session.generationId,
			clearedAt: Date.now(),
		},
	});
}

export type BtwRestoreInput = {
	customType?: string;
	details?: unknown;
	content?: unknown;
};

export function btwRestoreInputsFromAgentMessages(
	messages: AgentMessage[],
): BtwRestoreInput[] {
	return messages
		.filter(
			(
				message,
			): message is AgentMessage & { role: "custom"; customType: string } =>
				message.role === "custom" && isBtwResultMessage(message),
		)
		.map((message) => ({
			customType: message.customType,
			details: message.details,
			content: message.content,
		}));
}
