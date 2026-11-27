import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerReactionDelivery } from "./delivery.js";
import { reactionRow } from "./reaction-row.js";
import {
	isFinishedReply,
	projectReactions,
	readReplyId,
	REACTIONS,
	REACTION_ENTRY,
	REACTION_KEYS,
	REPLY_ROW,
	type Reaction,
} from "./reactions.js";

export default function reactions(pi: ExtensionAPI): void {
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
			cached = { manager, leaf, value: projectReactions(manager.getBranch()) };
		return cached.value;
	};

	const toggle = (
		ctx: ExtensionContext,
		replyId: string,
		reaction: Reaction,
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
			reaction: active === reaction ? null : reaction,
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
			const labels = REACTION_KEYS.map((reaction) => {
				const { icon, label } = REACTIONS[reaction];
				return `${icon} ${label}`;
			});
			const label = await ctx.ui.select("React to latest reply", labels);
			const reaction =
				label === undefined ? undefined : REACTION_KEYS[labels.indexOf(label)];
			if (reaction) toggle(ctx, entry.id, reaction);
		},
	});
}
