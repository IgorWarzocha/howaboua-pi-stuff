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
	agents: boolean,
	gpt = false,
): string {
	return [
		board
			? gpt
				? "Board→peer findings/discovery, ownership/decisions/blockers affecting peers. Self-contained detail welcome; direct discovery≠parent relay. Existing thread replies; known shared peers→link≠repeat. No ack/status spam/duplicate completion reports."
				: "Board: share findings, discoveries, ownership, decisions and blockers that change peers' work. Self-contained detail lets peers read directly, without a parent relay. Reply in existing threads. Link rather than repeat for peers with known Board access. Skip acknowledgements, routine status and duplicate completion reports."
			: "",
		notes
			? [
					board
						? gpt
							? "Notes→current work/progress/recovery + Board references."
							: "Notes: current work, progress and recovery, with Board references."
						: "",
					gpt
						? "Keep Notes checkpoints. Known recipient access→brief outcome/blocker + path; recipient READS checkpoint≠request full report."
						: "Keep checkpoints in Notes. When the recipient is known to have access, return a brief outcome or blocker plus its path. The recipient reads the checkpoint for details rather than asking for a full report.",
				]
					.filter(Boolean)
					.join(" ")
			: "",
		notes || board
			? gpt
				? `${notes && board ? "Notes/Board" : notes ? "Notes" : "Board"} available here≠recipient access. Unknown/unshared access→self-contained actions taken/findings/unresolved state, not bare references.`
				: `${notes && board ? "Notes and Board" : notes ? "Notes" : "Board"} availability here does not establish recipient access. If access is unknown or unshared, send a self-contained account of what you did, found and left unresolved, not just private references.`
			: "",
		agents && notes && board
			? gpt
				? "agents→assignments/urgent action≠default peer knowledge bus."
				: "Use agents for assignments and urgent action, not as the default peer knowledge relay."
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
			// Shepherdr keeps agents active, including as a nested Code/Notebook tool.
			const capabilities = [
				notes?.enabled(ctx) ?? false,
				board?.enabled(ctx) ?? false,
				pi.getActiveTools().includes("agents"),
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
