import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	CodexDeveloperCustomMessage,
	CodexDeveloperMessageOptions,
} from "@howaboua/pi-codex-conversion/developer-messages";
import type { ThreadSnapshot } from "./feedback.js";
import type { Thread } from "./github.js";

export function feedbackMessage(
	thread: Thread,
	snapshot: ThreadSnapshot,
	conversationChanges: number,
): string {
	const parts = [`GitHub watch: ${thread.url}.`];
	const pending = [...snapshot.unresolved.values()];
	if (thread.kind === "pr")
		parts.push(`${pending.length} unresolved review thread(s).`);
	if (pending.length) {
		parts.push(
			`Unresolved: ${pending
				.slice(0, 8)
				.map((item) => item.url)
				.join(
					" ",
				)}${pending.length > 8 ? ` (${pending.length - 8} more)` : ""}.`,
		);
		parts.push(
			"Read unresolved threads and replies with gh api graphql; paginate reviewThreads and comments, skipping isResolved threads.",
		);
	}
	if (conversationChanges)
		parts.push(
			`${conversationChanges} conversation/review update(s). Read context with gh ${thread.kind === "pr" ? "pr" : "issue"} view ${thread.number} --repo ${thread.repo} --comments.`,
		);
	parts.push(
		"Evaluate feedback. Where a response is needed, reply in its discussion with the fix or reasoned disposition. Verify the posting account before publishing.",
	);
	if (thread.kind === "pr")
		parts.push(
			"Resolve review threads once addressed, not while work remains. Do not re-review unchanged resolved threads.",
		);
	return parts.join(" ");
}

interface DeliveryRequest {
	protocol: 1;
	content: string;
	message: CodexDeveloperCustomMessage;
	options: CodexDeveloperMessageOptions;
	outcome?:
		| { ok: true }
		| { ok: false; reason: "unavailable" | "delivery"; error: string };
}

export function deliver(pi: ExtensionAPI, content: string) {
	const request: DeliveryRequest = {
		protocol: 1,
		content,
		message: { customType: "github-watch", content, display: true },
		options: { deliverAs: "followUp", triggerTurn: true },
	};
	pi.events.emit(
		"@howaboua/pi-codex-conversion.developer-custom-message/v1",
		request,
	);
	if (request.outcome?.ok) return;
	if (request.outcome?.reason === "delivery")
		throw new Error(request.outcome.error);
	// Native user messages stay chronological and traverse before_agent_start on idle wake.
	pi.sendUserMessage(content, { deliverAs: "followUp" });
}
