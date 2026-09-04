import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type CodexDeveloperMessageDelivery =
	| "steer"
	| "followUp"
	| "nextTurn";

export interface CodexDeveloperMessageOptions {
	deliverAs?: CodexDeveloperMessageDelivery;
	triggerTurn?: boolean;
}

export interface CodexDeveloperMessageDetails {
	protocol: 1;
	id: string;
}

export const CODEX_DEVELOPER_MESSAGE_TYPE = "codex-developer-message";

const DEVELOPER_MESSAGE_CHANNEL =
	"@howaboua/pi-codex-conversion.developer-message/v1";

type DeveloperMessageOutcome =
	| { ok: true }
	| { ok: false; reason: "unavailable" | "delivery"; error: string };

interface DeveloperMessageRequest {
	protocol: 1;
	content: string;
	options?: CodexDeveloperMessageOptions | undefined;
	outcome?: DeveloperMessageOutcome | undefined;
}

export function sendCodexDeveloperMessage(
	pi: ExtensionAPI,
	content: string,
	options?: CodexDeveloperMessageOptions,
): void {
	const outcome = dispatchCodexDeveloperMessage(pi, content, options);
	if (!outcome.ok) throw new Error(outcome.error);
}

export function trySendCodexDeveloperMessage(
	pi: ExtensionAPI,
	content: string,
	options?: CodexDeveloperMessageOptions,
): boolean {
	const outcome = dispatchCodexDeveloperMessage(pi, content, options);
	if (outcome.ok) return true;
	if (outcome.reason === "unavailable") return false;
	throw new Error(outcome.error);
}

function dispatchCodexDeveloperMessage(
	pi: ExtensionAPI,
	content: string,
	options: CodexDeveloperMessageOptions | undefined,
): DeveloperMessageOutcome {
	if (typeof content !== "string" || content.trim() === "")
		throw new Error("Codex developer message content cannot be empty");
	validateOptions(options);
	const request: DeveloperMessageRequest = {
		protocol: 1,
		content,
		...(options ? { options } : {}),
	};
	pi.events.emit(DEVELOPER_MESSAGE_CHANNEL, request);
	return (
		request.outcome ?? {
			ok: false,
			reason: "unavailable",
			error: "Pi Codex developer messages are unavailable",
		}
	);
}

export function registerCodexDeveloperMessageBroker(
	pi: ExtensionAPI,
	isActive: () => boolean,
): () => void {
	return pi.events.on(DEVELOPER_MESSAGE_CHANNEL, (value) => {
		if (!isDeveloperMessageRequest(value) || value.outcome) return;
		if (!isActive()) {
			value.outcome = {
				ok: false,
				reason: "unavailable",
				error:
					"Pi Codex developer messages require an active Responses adapter",
			};
			return;
		}
		try {
			pi.sendMessage<CodexDeveloperMessageDetails>(
				{
					customType: CODEX_DEVELOPER_MESSAGE_TYPE,
					content: value.content,
					display: true,
					details: { protocol: 1, id: randomUUID() },
				},
				value.options,
			);
			value.outcome = { ok: true };
		} catch (error) {
			value.outcome = {
				ok: false,
				reason: "delivery",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});
}

export function isCodexDeveloperMessageDetails(
	value: unknown,
): value is CodexDeveloperMessageDetails {
	return Boolean(
		value &&
			typeof value === "object" &&
			"protocol" in value &&
			value.protocol === 1 &&
			"id" in value &&
			typeof value.id === "string" &&
			value.id.trim() !== "",
	);
}

function isDeveloperMessageRequest(
	value: unknown,
): value is DeveloperMessageRequest {
	if (
		!value ||
		typeof value !== "object" ||
		!("protocol" in value) ||
		value.protocol !== 1 ||
		!("content" in value) ||
		typeof value.content !== "string" ||
		value.content.trim() === ""
	)
		return false;
	if (
		"outcome" in value &&
		value.outcome !== undefined &&
		!isDeveloperMessageOutcome(value.outcome)
	)
		return false;
	try {
		validateOptions(
			"options" in value
				? (value.options as CodexDeveloperMessageOptions | undefined)
				: undefined,
		);
		return true;
	} catch {
		return false;
	}
}

function isDeveloperMessageOutcome(
	value: unknown,
): value is DeveloperMessageOutcome {
	return Boolean(
		value &&
			typeof value === "object" &&
			"ok" in value &&
			(value.ok === true ||
				(value.ok === false &&
					"reason" in value &&
					(value.reason === "unavailable" || value.reason === "delivery") &&
					"error" in value &&
					typeof value.error === "string")),
	);
}

function validateOptions(
	options: CodexDeveloperMessageOptions | undefined,
): void {
	if (options === undefined) return;
	if (!options || typeof options !== "object")
		throw new Error("Codex developer message options must be an object");
	if (
		options.deliverAs !== undefined &&
		options.deliverAs !== "steer" &&
		options.deliverAs !== "followUp" &&
		options.deliverAs !== "nextTurn"
	)
		throw new Error("Invalid Codex developer message delivery mode");
	if (
		options.triggerTurn !== undefined &&
		typeof options.triggerTurn !== "boolean"
	)
		throw new Error("Codex developer message triggerTurn must be boolean");
}
