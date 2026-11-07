import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { BoardAwareness } from "../awareness.js";
import { binding } from "../identity.js";
import type { BoardEnvelope } from "../protocol.js";

/** Validates unread responses against the still-selected membership before acceptance. */
export class BoardCatchup {
	private readonly pi: ExtensionAPI;
	private readonly awareness: BoardAwareness;
	private readonly request: (
		ctx: ExtensionContext,
		request: BoardEnvelope,
	) => Promise<unknown>;
	private readonly availability: (
		ctx: ExtensionContext,
		error?: unknown,
	) => void;
	private readonly gpt: () => boolean;
	constructor(
		pi: ExtensionAPI,
		awareness: BoardAwareness,
		request: (
			ctx: ExtensionContext,
			request: BoardEnvelope,
		) => Promise<unknown>,
		availability: (ctx: ExtensionContext, error?: unknown) => void,
		gpt: () => boolean,
	) {
		this.pi = pi;
		this.awareness = awareness;
		this.request = request;
		this.availability = availability;
		this.gpt = gpt;
	}
	async read(
		ctx: ExtensionContext,
	): Promise<{ content: string; accepted: () => void }> {
		const empty = { content: "", accepted: () => {} };
		const own = binding(ctx);
		if (!own.enabled) return empty;
		try {
			const result = await this.request(ctx, {
				operation: "board-catchup",
				caller: own,
				seen: this.awareness.seen(ctx),
			});
			if (
				!Array.isArray(result) ||
				!result.every(
					(post) =>
						post &&
						typeof post.message_id === "string" &&
						typeof post.thread_id === "string",
				)
			)
				throw new Error("Invalid board catch-up response");
			if (
				!binding(ctx).enabled ||
				binding(ctx).sessionId !== own.sessionId ||
				binding(ctx).boardId !== own.boardId ||
				binding(ctx).agentName !== own.agentName
			)
				return empty;
			this.availability(ctx);
			const nested = this.pi
				.getActiveTools()
				.some((tool) => ["exec", "code", "notebook"].includes(tool));
			return {
				content: result.length
					? `\n\n${this.gpt() ? "Unread board updates→read task-relevant threads:" : "Unread board updates available; read if relevant to the current task:"} ${[
							...new Set(result.map((post) => post.thread_id)),
						]
							.map((thread_id) => {
								const args = JSON.stringify({
									action: "read_thread",
									thread_id,
								});
								return nested ? `await tools.board(${args})` : `board ${args}`;
							})
							.join("; ")}`
					: "",
				accepted: () =>
					this.awareness.markSeen(
						ctx,
						result.map((post) => post.message_id),
					),
			};
		} catch (error) {
			this.availability(ctx, error);
			return empty;
		}
	}
}
