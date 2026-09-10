import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	CodexDeveloperCustomMessage,
	CodexDeveloperMessageOptions,
	trySendCodexDeveloperCustomMessage,
	tryStartCodexPreparedIdleKickoff,
} from "@howaboua/pi-codex-conversion/developer-messages";

const senders = new WeakMap<
	ExtensionAPI,
	typeof trySendCodexDeveloperCustomMessage
>();
const preparedKickoffs = new WeakMap<
	ExtensionAPI,
	typeof tryStartCodexPreparedIdleKickoff
>();
const fallbackKickoffs = new WeakMap<
	ExtensionAPI,
	"preparing" | "running" | "queued"
>();
const PACKAGE = "@howaboua/pi-codex-conversion";
const MODULE = `${PACKAGE}/developer-messages`;

export async function registerDeveloperDelivery(
	pi: ExtensionAPI,
): Promise<void> {
	try {
		const api = await import(
			"@howaboua/pi-codex-conversion/developer-messages"
		);
		if (typeof api.trySendCodexDeveloperCustomMessage === "function")
			senders.set(pi, api.trySendCodexDeveloperCustomMessage);
		if (typeof api.tryStartCodexPreparedIdleKickoff === "function")
			preparedKickoffs.set(pi, api.tryStartCodexPreparedIdleKickoff);
	} catch (error) {
		if (!isUnavailable(error)) throw error;
	}
	pi.on("session_start", () => {
		fallbackKickoffs.delete(pi);
	});
	pi.on("session_tree", () => {
		fallbackKickoffs.delete(pi);
	});
	pi.on("agent_start", () => {
		if (fallbackKickoffs.get(pi) === "preparing")
			fallbackKickoffs.set(pi, "running");
	});
	pi.on("agent_settled", (_event, ctx) => {
		const state = fallbackKickoffs.get(pi);
		if (state === "running" || state === "queued") fallbackKickoffs.delete(pi);
		if (state === "queued") startPreparedIdleTurn(pi, ctx);
	});
	pi.on("session_shutdown", () => {
		fallbackKickoffs.delete(pi);
	});
	pi.on("input", (event, ctx) => {
		// Idle prompts must run Pi's complete before_agent_start preparation chain.
		if (
			ctx.isIdle() ||
			event.streamingBehavior === undefined ||
			event.images?.length ||
			!/^<herdr_sender [^\n]+ \/>\n/.test(event.text)
		)
			return;
		if (
			senders.get(pi)?.(
				pi,
				{
					customType: "herdr-agent-message",
					content: event.text,
					display: true,
				},
				{ deliverAs: event.streamingBehavior },
			)
		) {
			return { action: "handled" };
		}
		return;
	});
}

export function startPreparedIdleTurn(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "ui">,
): void {
	if (preparedKickoffs.get(pi)?.(pi, ctx)) return;
	if (fallbackKickoffs.has(pi)) {
		// Pi is already idle while earlier settlement handlers are awaiting.
		if (fallbackKickoffs.get(pi) === "running")
			fallbackKickoffs.set(pi, "queued");
		ctx.ui.notify(
			"An automatic turn is pending. If no turn starts, send a user message or reload the session.",
			"warning",
		);
		return;
	}
	fallbackKickoffs.set(pi, "preparing");
	try {
		pi.sendUserMessage("Continue.", { deliverAs: "steer" });
	} catch (error) {
		fallbackKickoffs.delete(pi);
		throw error;
	}
}

export function sendPolicyMessage(
	pi: ExtensionAPI,
	message: CodexDeveloperCustomMessage,
	options: CodexDeveloperMessageOptions,
): void {
	if (senders.get(pi)?.(pi, message, options)) return;
	pi.sendMessage(message, options);
}

function isUnavailable(error: unknown): boolean {
	if (
		!error ||
		typeof error !== "object" ||
		!("code" in error) ||
		!("message" in error) ||
		typeof error.message !== "string"
	)
		return false;
	if (
		error.code === "ERR_MODULE_NOT_FOUND" ||
		error.code === "MODULE_NOT_FOUND"
	) {
		const missing = error.message.match(
			/Cannot find (?:package|module) ['"]([^'"]+)['"]/,
		)?.[1];
		const normalized = missing?.replaceAll("\\", "/").replace(/\.js$/, "");
		return (
			missing === PACKAGE ||
			normalized === MODULE ||
			normalized?.endsWith(`/${MODULE}`) === true
		);
	}
	return (
		(error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
			error.code === "ERR_UNSUPPORTED_DIR_IMPORT") &&
		(error.message.includes(MODULE) ||
			(error.message.includes("Package subpath './developer-messages'") &&
				error.message.includes(PACKAGE)))
	);
}
