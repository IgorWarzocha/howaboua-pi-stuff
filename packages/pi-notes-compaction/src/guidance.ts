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
	gptPromptMode(): boolean;
}

/** Routing belongs here; feature carriers retain identity, recovery and navigation. */
function communicationGuidance(
	notes: boolean,
	board: boolean,
	gpt = false,
): string {
	return [
		board
			? gpt
				? "Board→new peer-work findings/decisions/ownership/blockers only; no change→no post. No idle wake; active subscribers may be interrupted."
				: "Board: post only new findings, decisions, ownership changes or blockers that change peers' work. Reports without such a change need no post. Posts do not wake idle agents but may interrupt active subscribers."
			: "",
		notes
			? [
					gpt
						? "Notes writes don't wake peers."
						: "Notes writes do not wake peers.",
					board
						? gpt
							? "Notes→recovery; link Board evidence."
							: "Notes holds recovery checkpoints; link Board evidence."
						: "",
					gpt
						? "Known recipient Notes access→brief outcome/blocker + checkpoint path; recipient reads details."
						: "With known recipient Notes access, return a brief outcome or blocker plus the checkpoint path; the recipient reads the details.",
				]
					.filter(Boolean)
					.join(" ")
			: "",
		notes || board
			? gpt
				? `${notes && board ? "Notes/Board" : notes ? "Notes" : "Board"} available here≠recipient access. Known access→link≠repeat; otherwise self-contained actions/findings/unresolved state.`
				: `${notes && board ? "Notes and Board" : notes ? "Notes" : "Board"} availability here does not establish recipient access. Link rather than repeat when access is known; otherwise give a self-contained account of actions, findings and unresolved state.`
			: "",
		notes || board
			? gpt
				? "Direct messages→assignments or urgent action, not status or courtesy updates."
				: "Use direct messages for assignments or urgent action, not status or courtesy updates."
			: "",
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
				Boolean(notes?.gptPromptMode() || board?.gptPromptMode()),
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
