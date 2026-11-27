import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { reactionRow } from "./reaction-row.js";
import {
	projectReactions,
	readReplyReference,
	replyReference,
	REACTIONS,
	REACTION_ENTRY,
	REACTION_KEYS,
	REPLY_ROW,
	type Reaction,
	type ReplyReference,
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
		reply: ReplyReference,
		reaction: Reaction,
	) => {
		if (!ctx.isIdle()) {
			ctx.ui.notify("Wait for the turn to finish before reacting", "info");
			return true;
		}
		if (
			!ctx.sessionManager
				.getBranch()
				.some((entry) => entry.id === reply.replyId)
		)
			return false;
		const active = read(ctx).selected.get(reply.replyId);
		pi.appendEntry(REACTION_ENTRY, {
			...reply,
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
		if (!entry || entry.type !== "message") return;
		const reply = replyReference(entry);
		if (
			!reply ||
			branch.some(
				(item) =>
					item.type === "custom" &&
					item.customType === REPLY_ROW &&
					readReplyReference(item.data)?.replyId === reply.replyId,
			)
		)
			return;
		pi.appendEntry(REPLY_ROW, reply);
	});
	pi.registerEntryRenderer(REPLY_ROW, (entry, _options, theme) => {
		const reply = readReplyReference(entry.data);
		if (!reply) return undefined;
		return reactionRow(
			theme,
			() =>
				uiContext ? read(uiContext).selected.get(reply.replyId) : undefined,
			(reaction) => (uiContext ? toggle(uiContext, reply, reaction) : false),
		);
	});
	pi.on("input", (event, ctx) => {
		if (
			event.source !== "interactive" ||
			event.streamingBehavior ||
			/^[!/]/u.test(event.text.trimStart())
		)
			return;
		const { prefix } = read(ctx);
		if (prefix) return { action: "transform", text: prefix + event.text };
	});
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
					(item) =>
						item.type === "message" && replyReference(item) !== undefined,
				);
			const reply =
				entry?.type === "message" ? replyReference(entry) : undefined;
			if (!reply) {
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
			if (reaction) toggle(ctx, reply, reaction);
		},
	});
}
