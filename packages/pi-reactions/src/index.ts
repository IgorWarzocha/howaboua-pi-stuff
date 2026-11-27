import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadReactions } from "./config.js";
import { registerReactionDelivery } from "./delivery.js";
import { reactionRow } from "./reaction-row.js";
import {
	isFinishedReply,
	projectReactions,
	readReplyId,
	REACTION_ENTRY,
	REPLY_ROW,
} from "./reactions.js";

export default function reactions(pi: ExtensionAPI): void {
	const definitions = loadReactions();
	if (!definitions.length) return;
	const byId = new Map(definitions.map((reaction) => [reaction.id, reaction]));
	const choices = new Map(
		definitions.map((reaction) => [
			`${reaction.icon} ${reaction.label}`,
			reaction.id,
		]),
	);
	let uiContext: ExtensionContext | undefined;
	let cached:
		| {
				manager: ExtensionContext["sessionManager"];
				leaf: string | null;
				value: ReturnType<typeof projectReactions>;
		  }
		| undefined;

	const read = (ctx: ExtensionContext) => {
		const manager = ctx.sessionManager;
		const leaf = manager.getLeafId();
		if (!cached || cached.manager !== manager || cached.leaf !== leaf)
			cached = {
				manager,
				leaf,
				value: projectReactions(manager.getBranch(), byId),
			};
		return cached.value;
	};

	const toggle = (
		ctx: ExtensionContext,
		replyId: string,
		reactionId: string,
	) => {
		if (!ctx.isIdle()) {
			ctx.ui.notify("Wait for the turn to finish before reacting", "info");
			return true;
		}
		if (!ctx.sessionManager.getBranch().some((entry) => entry.id === replyId))
			return false;
		const active = read(ctx).selected.get(replyId);
		pi.appendEntry(REACTION_ENTRY, {
			replyId,
			reaction: active?.id === reactionId ? null : reactionId,
		});
		return true;
	};

	pi.on("session_start", (_event, ctx) => {
		uiContext = ctx.mode === "tui" ? ctx : undefined;
		cached = undefined;
	});
	pi.on("session_shutdown", () => {
		uiContext = undefined;
		cached = undefined;
	});
	pi.on("agent_settled", (event, ctx) => {
		if (ctx.mode !== "tui" || event.aborted) return;
		const branch = ctx.sessionManager.getBranch();
		const entry = branch.findLast((item) => item.type === "message");
		if (
			!entry ||
			entry.type !== "message" ||
			!isFinishedReply(entry.message) ||
			branch.some(
				(item) =>
					item.type === "custom" &&
					item.customType === REPLY_ROW &&
					readReplyId(item.data) === entry.id,
			)
		)
			return;
		pi.appendEntry(REPLY_ROW, { replyId: entry.id });
	});
	pi.registerEntryRenderer(REPLY_ROW, (entry, _options, theme) => {
		const replyId = readReplyId(entry.data);
		if (!replyId) return undefined;
		return reactionRow(
			theme,
			pi.getSettings().outputPad === 0 ? 0 : 1,
			definitions,
			() => (uiContext ? read(uiContext).selected.get(replyId) : undefined),
			(reaction) => (uiContext ? toggle(uiContext, replyId, reaction) : false),
		);
	});
	registerReactionDelivery(pi, read);
	pi.registerCommand("react", {
		description: "React to the latest finished reply",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the turn to finish before reacting", "info");
				return;
			}
			const entry = ctx.sessionManager
				.getBranch()
				.findLast(
					(item) => item.type === "message" && isFinishedReply(item.message),
				);
			if (!entry) {
				ctx.ui.notify("No reply to react to", "info");
				return;
			}
			const choice = await ctx.ui.select("React to latest reply", [
				...choices.keys(),
			]);
			const reactionId = choice === undefined ? undefined : choices.get(choice);
			if (reactionId) toggle(ctx, entry.id, reactionId);
		},
	});
}
