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

const CUSTOM_DEVELOPER_DETAILS_KEY = "@howaboua/pi-codex-conversion/developer-message";

export interface CodexDeveloperCustomMessage {
	customType: string;
	content: string;
	display: boolean;
	/** Plain object; the namespaced developer-message key is reserved. */
	details?: object;
}

const DEVELOPER_MESSAGE_CHANNEL =
	"@howaboua/pi-codex-conversion.developer-message/v1";
const CUSTOM_DEVELOPER_MESSAGE_CHANNEL =
	"@howaboua/pi-codex-conversion.developer-custom-message/v1";

type DeveloperMessageOutcome =
	| { ok: true }
	| { ok: false; reason: "unavailable" | "delivery"; error: string };

interface DeveloperMessageRequest {
	protocol: 1;
	content: string;
	options?: CodexDeveloperMessageOptions | undefined;
	message?: CodexDeveloperCustomMessage | undefined;
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

/** Preserve caller rendering and detail fields; false means nothing was sent. */
export function trySendCodexDeveloperCustomMessage(
	pi: ExtensionAPI,
	message: CodexDeveloperCustomMessage,
	options?: CodexDeveloperMessageOptions,
): boolean {
	validateCustomMessage(message);
	const outcome = dispatchCodexDeveloperMessage(pi, message.content, options, message);
	if (outcome.ok) return true;
	if (outcome.reason === "unavailable") return false;
	throw new Error(outcome.error);
}

function dispatchCodexDeveloperMessage(
	pi: ExtensionAPI,
	content: string,
	options: CodexDeveloperMessageOptions | undefined,
	message?: CodexDeveloperCustomMessage,
): DeveloperMessageOutcome {
	if (typeof content !== "string" || content.trim() === "")
		throw new Error("Codex developer message content cannot be empty");
	validateOptions(options);
	const request: DeveloperMessageRequest = {
		protocol: 1,
		content,
		...(options ? { options } : {}),
		...(message ? { message } : {}),
	};
	pi.events.emit(message ? CUSTOM_DEVELOPER_MESSAGE_CHANNEL : DEVELOPER_MESSAGE_CHANNEL, request);
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
	const deliver = (value: unknown) => {
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
			const metadata: CodexDeveloperMessageDetails = { protocol: 1, id: randomUUID() };
			pi.sendMessage<object>(
				value.message ? {
					...value.message,
					details: { ...value.message.details, [CUSTOM_DEVELOPER_DETAILS_KEY]: metadata },
				} : {
					customType: CODEX_DEVELOPER_MESSAGE_TYPE,
					content: value.content,
					display: true,
					details: metadata,
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
	};
	const unregister = [
		pi.events.on(DEVELOPER_MESSAGE_CHANNEL, deliver),
		pi.events.on(CUSTOM_DEVELOPER_MESSAGE_CHANNEL, deliver),
	];
	return () => { for (const remove of unregister) remove(); };
}

export function customDeveloperMessageMetadata(details: unknown): unknown {
	return details && typeof details === "object" && CUSTOM_DEVELOPER_DETAILS_KEY in details
		? details[CUSTOM_DEVELOPER_DETAILS_KEY] : undefined;
}

function validateCustomMessage(message: CodexDeveloperCustomMessage): void {
	if (!message || typeof message !== "object" ||
		typeof message.customType !== "string" || !message.customType.trim() ||
		typeof message.display !== "boolean")
		throw new Error("Codex developer custom messages require a caller-owned customType and boolean display");
	const details = message.details;
	if (details !== undefined && (!details || typeof details !== "object" ||
		(Object.getPrototypeOf(details) !== Object.prototype && Object.getPrototypeOf(details) !== null) ||
		CUSTOM_DEVELOPER_DETAILS_KEY in details))
		throw new Error("Codex developer custom message details must be a plain object without the reserved developer-message key");
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
		if ("message" in value && value.message !== undefined) {
			validateCustomMessage(value.message as CodexDeveloperCustomMessage);
			if ((value.message as CodexDeveloperCustomMessage).content !== value.content) return false;
		}
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
