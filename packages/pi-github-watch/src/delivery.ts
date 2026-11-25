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
	headChange?: { before: string; after: string },
): string {
	const parts = [`GitHub watch: ${thread.url}.`];
	if (headChange)
		parts.push(
			`PR head: ${headChange.before} → ${headChange.after}. Diff: gh pr diff ${thread.number} --repo ${thread.repo}`,
		);
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
			"gh api graphql: paginate reviewThreads and comments; skip isResolved threads.",
		);
	}
	if (conversationChanges)
		parts.push(
			`${conversationChanges} conversation/review update(s). Context: gh ${thread.kind === "pr" ? "pr" : "issue"} view ${thread.number} --repo ${thread.repo} --comments`,
		);
	parts.push(
		"Assess feedback against task scope. If replying, verify posting account and post the fix or rationale in its discussion.",
	);
	if (thread.kind === "pr")
		parts.push(
			"Resolve only after the work is complete. Skip unchanged resolved threads.",
		);
	return parts.join("\n");
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
