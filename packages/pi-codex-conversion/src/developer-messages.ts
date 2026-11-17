import { randomUUID } from "node:crypto";
import { admitCustomTurn } from "./custom-turn-admission.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
export {
	CODEX_CONTEXT_BRIEFING_TYPE,
	registerCodexContextBriefing,
	hasCodexContextBriefingHost,
	type CodexContextBriefing,
	type CodexContextBriefingHandler,
} from "./context-briefings.js";

export type CodexDeveloperMessageDelivery = "steer" | "followUp" | "nextTurn";

export interface CodexDeveloperMessageOptions {
	deliverAs?: CodexDeveloperMessageDelivery;
	triggerTurn?: boolean;
}

export interface CodexDeveloperMessageDetails {
	protocol: 1;
	id: string;
}

export const CODEX_DEVELOPER_MESSAGE_TYPE = "codex-developer-message";

const CUSTOM_DEVELOPER_DETAILS_KEY =
	"@howaboua/pi-codex-conversion/developer-message";

/** Annotate a boundary entry without sending or starting a turn. */
export function withCodexDeveloperMessageDetails<
	T extends { details?: unknown },
>(message: T): T {
	const details = message.details;
	if (!details || typeof details !== "object" || Array.isArray(details))
		throw new Error(
			"Context reminder could not be delivered. Reload Pi and try again.",
		);
	return {
		...message,
		details: {
			...details,
			[CUSTOM_DEVELOPER_DETAILS_KEY]: { protocol: 1, id: randomUUID() },
		},
	};
}
const PENDING_DEVELOPER_MESSAGE_TYPE = "codex-pending-developer-message";

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

/** Event-bus request for integrations that must work without loading PCC. */
export interface CodexDeveloperMessageRequest {
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
	const outcome = dispatchCodexDeveloperMessage(
		pi,
		message.content,
		options,
		message,
	);
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
	const request: CodexDeveloperMessageRequest = {
		protocol: 1,
		content,
		...(options ? { options } : {}),
		...(message ? { message } : {}),
	};
	pi.events.emit(
		message ? CUSTOM_DEVELOPER_MESSAGE_CHANNEL : DEVELOPER_MESSAGE_CHANNEL,
		request,
	);
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
	let currentContext: ExtensionContext | undefined;
	pi.on("session_start", (event, ctx) => {
		currentContext = ctx;
		// Pi reloads extensions in place and retains nextTurn. A replacement
		// AgentSession has an empty queue; recover accepted, unconsumed entries.
		const entries = ctx.sessionManager.getEntries();
		const pending = entries.flatMap((entry) =>
			entry.type === "custom" &&
			entry.customType === PENDING_DEVELOPER_MESSAGE_TYPE
				? [readPendingDeveloperMessage(entry.data)]
				: [],
		);
		const delivered = new Set(
			entries.flatMap((entry) =>
				entry.type === "custom_message" ? [developerMessageId(entry)] : [],
			),
		);
		const queued = new Set(
			pending
				.filter((data) => data.queued)
				.map((data) => developerMessageId(data.message)),
		);
		let restored = false;
		for (const data of pending) {
			const id = developerMessageId(data.message);
			if (
				data.sessionId !== ctx.sessionManager.getSessionId() ||
				delivered.has(id) ||
				(event.reason === "reload" && queued.has(id))
			)
				continue;
			pi.sendMessage(data.message, {
				deliverAs: "nextTurn",
				triggerTurn: false,
			});
			delivered.add(id);
			if (!data.queued)
				pi.appendEntry(PENDING_DEVELOPER_MESSAGE_TYPE, {
					...data,
					protocol: 1,
					queued: true,
				});
			restored = true;
		}
		if (restored)
			ctx.ui.notify(
				"Pending developer messages restored. Send a message to continue.",
				"warning",
			);
	});
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
			const metadata: CodexDeveloperMessageDetails = {
				protocol: 1,
				id: randomUUID(),
			};
			const deferred = value.options?.deliverAs === "nextTurn";
			const message = value.message
				? {
						...value.message,
						details: {
							...value.message.details,
							[CUSTOM_DEVELOPER_DETAILS_KEY]: metadata,
						},
					}
				: {
						customType: CODEX_DEVELOPER_MESSAGE_TYPE,
						content: value.content,
						display: true,
						details: metadata,
					};
			// nextTurn only queues context, even when the caller also sets triggerTurn.
			const preparation =
				!deferred && value.options?.triggerTurn && currentContext
					? admitCustomTurn(pi, currentContext)
					: undefined;
			if (deferred || preparation) {
				if (!currentContext)
					throw new Error(
						"Developer message delivery requires a started session",
					);
				// Journal metadata is not conversation: it cannot stale Notes before admission.
				pi.appendEntry(PENDING_DEVELOPER_MESSAGE_TYPE, {
					protocol: 1,
					sessionId: currentContext.sessionManager.getSessionId(),
					message,
					queued: deferred,
				});
			}
			if (preparation && currentContext) {
				const ctx = currentContext;
				const sessionId = ctx.sessionManager.getSessionId();
				void preparation
					.then(() => {
						if (
							currentContext !== ctx ||
							ctx.sessionManager.getSessionId() !== sessionId
						)
							throw new Error("Session changed before message delivery");
						pi.sendMessage<object>(message, value.options);
					})
					.catch((error) => {
						// A replacement owner restores the durable message; old ctx is invalid.
						if (currentContext === ctx)
							ctx.ui.notify(
								`Message remains pending: ${String(error)}. Retry rollover or reload the session.`,
								"error",
							);
					});
			} else
				pi.sendMessage<object>(
					message,
					deferred
						? { ...value.options, triggerTurn: false, deliverAs: "nextTurn" }
						: value.options,
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
	return () => {
		currentContext = undefined;
		for (const remove of unregister) remove();
	};
}

export function customDeveloperMessageMetadata(details: unknown): unknown {
	return details &&
		typeof details === "object" &&
		CUSTOM_DEVELOPER_DETAILS_KEY in details
		? details[CUSTOM_DEVELOPER_DETAILS_KEY]
		: undefined;
}

function developerMessageId(message: {
	customType: string;
	details?: unknown;
}): string | undefined {
	const metadata =
		message.customType === CODEX_DEVELOPER_MESSAGE_TYPE
			? message.details
			: customDeveloperMessageMetadata(message.details);
	return isCodexDeveloperMessageDetails(metadata) ? metadata.id : undefined;
}

function readPendingDeveloperMessage(value: unknown): {
	sessionId: string;
	message: CodexDeveloperCustomMessage;
	queued: boolean;
} {
	if (
		value &&
		typeof value === "object" &&
		"protocol" in value &&
		value.protocol === 1 &&
		"sessionId" in value &&
		typeof value.sessionId === "string" &&
		"message" in value &&
		value.message &&
		typeof value.message === "object"
	) {
		const message = value.message as CodexDeveloperCustomMessage;
		if (
			typeof message.customType === "string" &&
			message.customType.trim() &&
			typeof message.content === "string" &&
			message.content.trim() &&
			typeof message.display === "boolean" &&
			developerMessageId(message)
		)
			return {
				sessionId: value.sessionId,
				message,
				queued: !("queued" in value) || value.queued !== false,
			};
	}
	throw new Error("Stored pending developer message is invalid");
}

function validateCustomMessage(message: CodexDeveloperCustomMessage): void {
	if (
		!message ||
		typeof message !== "object" ||
		typeof message.customType !== "string" ||
		!message.customType.trim() ||
		typeof message.display !== "boolean"
	)
		throw new Error(
			"Codex developer custom messages require a caller-owned customType and boolean display",
		);
	const details = message.details;
	if (
		details !== undefined &&
		(!details ||
			typeof details !== "object" ||
			(Object.getPrototypeOf(details) !== Object.prototype &&
				Object.getPrototypeOf(details) !== null) ||
			CUSTOM_DEVELOPER_DETAILS_KEY in details)
	)
		throw new Error(
			"Codex developer custom message details must be a plain object without the reserved developer-message key",
		);
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
): value is CodexDeveloperMessageRequest {
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
			if (
				(value.message as CodexDeveloperCustomMessage).content !== value.content
			)
				return false;
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
