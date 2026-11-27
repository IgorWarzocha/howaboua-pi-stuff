import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexDeveloperMessageRequest } from "@howaboua/pi-codex-conversion/developer-messages";
import type { projectReactions } from "./reactions.js";

export function registerReactionDelivery(
	pi: ExtensionAPI,
	read: (ctx: ExtensionContext) => ReturnType<typeof projectReactions>,
): (ctx: ExtensionContext, replyId: string) => Promise<void> {
	let interactiveSession: string | undefined;
	let currentContext: ExtensionContext | undefined;
	pi.on("session_start", (_event, ctx) => {
		interactiveSession = undefined;
		currentContext = ctx;
	});
	pi.on("session_shutdown", () => {
		currentContext = undefined;
	});
	pi.on("input", (event, ctx) => {
		interactiveSession =
			event.source === "interactive" &&
			!event.streamingBehavior &&
			!/^[!/]/u.test(event.text.trimStart())
				? ctx.sessionManager.getSessionId()
				: undefined;
	});
	pi.on("before_agent_start", (event, ctx) => {
		const interactive =
			interactiveSession === ctx.sessionManager.getSessionId();
		interactiveSession = undefined;
		if (!interactive || event.messageType !== "user") return;
		const message = read(ctx).messageFor();
		if (!message) return;
		// Pi drains nextTurn after this hook, in the same kickoff as the user prompt.
		const request: CodexDeveloperMessageRequest = {
			protocol: 1,
			content: message.content,
			message,
			options: { deliverAs: "nextTurn", triggerTurn: false },
		};
		pi.events.emit(
			"@howaboua/pi-codex-conversion.developer-custom-message/v1",
			request,
		);
		if (request.outcome?.ok) return;
		if (request.outcome?.reason === "delivery")
			throw new Error(request.outcome.error);
		return { message };
	});

	return async (ctx, replyId) => {
		const message = read(ctx).messageFor(replyId);
		if (!message || !ctx.isIdle()) return;
		const owner = currentContext;
		const sessionId = ctx.sessionManager.getSessionId();
		const isCurrent = () =>
			currentContext === owner &&
			ctx.sessionManager.getSessionId() === sessionId;
		try {
			const request: {
				protocol: 1;
				ctx: ExtensionContext;
				preparation?: Promise<void>;
			} = { protocol: 1, ctx };
			pi.events.emit("pi-notes-compaction:custom-turn-admission:v1", request);
			if (request.preparation) await request.preparation;
			if (!isCurrent() || !ctx.isIdle()) return;
			const pending = read(ctx).messageFor(replyId);
			if (
				pending &&
				pending.details.selectionIds[0] === message.details.selectionIds[0]
			)
				pi.sendMessage(pending, { triggerTurn: true });
		} catch (error) {
			if (isCurrent())
				ctx.ui.notify(
					`Reaction could not start a turn: ${String(error)}`,
					"error",
				);
		}
	};
}
