import { readExtensionMessage } from "../remote/shepherdr-session.mjs";
import type { ExtensionMessage } from "../types.js";
export const AGENT_EVENT_MESSAGE_TYPE = "herdr-agent-event";

export interface AgentEventDetails {
	extensionMessages?: ExtensionMessage[];
	blockedOn?: string;
	cwd?: string;
	machine: string;
	machineLabel?: string;
	name?: string;
	paneId: string;
	response?: string;
	state: "blocked" | "failed" | "finished" | "extension-message";
	tab?: string;
	task?: string;
	workspace?: string;
}

function eventExtensionMessages(
	value: unknown,
): ExtensionMessage[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const messages = value.map((message) => {
		if (typeof message !== "object" || message === null) return undefined;
		return readExtensionMessage({ ...message, version: 1, state: "pending" });
	});
	return messages.every((message) => message !== undefined)
		? messages
		: undefined;
}

export function eventDetails(value: unknown): AgentEventDetails | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const details = value as Record<string, unknown>;
	if (
		typeof details["paneId"] !== "string" ||
		(details["machine"] !== undefined &&
			typeof details["machine"] !== "string") ||
		(details["state"] !== "blocked" &&
			details["state"] !== "extension-message" &&
			details["state"] !== "failed" &&
			details["state"] !== "finished")
	) {
		return undefined;
	}
	const optional = (field: keyof AgentEventDetails) =>
		typeof details[field] === "string"
			? { [field]: details[field] as string }
			: {};
	const extensionMessages = eventExtensionMessages(
		details["extensionMessages"],
	);
	return {
		machine:
			typeof details["machine"] === "string" ? details["machine"] : "local",
		paneId: details["paneId"],
		state: details["state"],
		...(extensionMessages ? { extensionMessages } : {}),
		...optional("blockedOn"),
		...optional("cwd"),
		...optional("machineLabel"),
		...optional("name"),
		...optional("response"),
		...optional("tab"),
		...optional("task"),
		...optional("workspace"),
	};
}
