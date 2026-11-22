import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	contextBriefingWindow,
	recordContextBriefing,
	registerContextBriefing,
} from "./board/context-briefing.js";
import type { FeatureSettings } from "./settings-navigation.js";

export interface CommsFeature extends FeatureSettings {
	enabled(ctx: ExtensionContext): boolean;
}

/** Routing belongs here; feature carriers retain identity, recovery and navigation. */
function communicationGuidance(notes: boolean, board: boolean): string {
	if (!notes && !board) return "";
	const surfaces = notes && board ? "Notes/Board" : notes ? "Notes" : "Board";
	const recipientAccess =
		notes && board
			? "known recipient access to the linked surface"
			: "known recipient access";
	return [
		board
			? "Board→only findings/decisions/ownership/blockers that change peer work. Peers read directly, no parent relay. Posts can interrupt active subscribers; idle peers stay idle."
			: "",
		notes
			? `Notes writes don't wake peers.${board ? " Notes→recovery; link Board evidence." : ""}`
			: "",
		`${surfaces} access here≠recipient access. Link only with ${recipientAccess}${notes ? "; add only brief outcome/blocker; recipient reads source" : "; don't repeat"}. Otherwise self-contained actions/findings/unresolved state.`,
		"Direct messages→assignments or urgent action only.",
	]
		.filter(Boolean)
		.join(" ");
}

export function registerCommunicationGuidance(
	pi: ExtensionAPI,
	notes?: CommsFeature,
	board?: CommsFeature,
): void {
	const owner =
		notes && board
			? "agent-comms-routing"
			: notes
				? "notes-routing"
				: "board-routing";
	registerContextBriefing(
		pi,
		"communication",
		(ctx) => Boolean(notes?.enabled(ctx) || board?.enabled(ctx)),
		async (ctx, windowId, messages) => {
			// Feature owners supply enablement independently of provider declarations.
			const capabilities = [
				notes?.enabled(ctx) ?? false,
				board?.enabled(ctx) ?? false,
			] as const;
			const routing = communicationGuidance(...capabilities);
			const previous = messages
				?.flatMap((message) => {
					if (
						message.role !== "custom" ||
						message.customType !== "codex-context-briefing"
					)
						return [];
					const details = message.details;
					return details &&
						typeof details === "object" &&
						"owner" in details &&
						details.owner === owner &&
						"id" in details &&
						typeof details.id === "string"
						? [{ id: details.id, content: message.content }]
						: [];
				})
				.at(-1);
			if (!routing && !previous) return;
			const content =
				routing ||
				`${notes && board ? "Notes and Board are" : notes ? "Notes is" : "Board is"} currently inactive. Earlier communication routing no longer applies.`;
			if (previous?.content === content) return;
			await recordContextBriefing(
				pi,
				ctx,
				owner,
				JSON.stringify([
					ctx.sessionManager.getSessionId(),
					contextBriefingWindow(ctx, windowId),
					...capabilities,
					previous?.id,
				]),
				async () => content,
			);
		},
	);
}
