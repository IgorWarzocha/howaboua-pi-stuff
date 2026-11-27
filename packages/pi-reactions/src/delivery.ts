import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexDeveloperMessageRequest } from "@howaboua/pi-codex-conversion/developer-messages";
import type { projectReactions } from "./reactions.js";

export function registerReactionDelivery(
	pi: ExtensionAPI,
	read: (ctx: ExtensionContext) => ReturnType<typeof projectReactions>,
): void {
	let interactiveSession: string | undefined;
	pi.on("session_start", () => {
		interactiveSession = undefined;
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
		const { message } = read(ctx);
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
}
