import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { sendPolicyMessage } from "../delivery.js";
import { type BoardBinding, binding } from "./identity.js";
import type { BoardEnvelope } from "./protocol.js";

type ActiveEnvelope = Extract<BoardEnvelope, { operation: "board-active" }>;
type NoticeEnvelope = Extract<BoardEnvelope, { operation: "board-notify" }>;

/** Turn IDs are transient capabilities. A stale snapshot cannot reach a later turn. */
export class BoardTurns {
	private current: { ctx: ExtensionContext; turnId: string } | undefined;
	readonly active = new Map<string, { sessionId: string; turnId: string }>();
	constructor(
		pi: ExtensionAPI,
		register: (
			ctx: ExtensionContext,
			request: ActiveEnvelope,
		) => Promise<unknown>,
	) {
		pi.on("session_start", () => {
			this.current = undefined;
			this.active.clear();
		});
		pi.on("agent_start", async (_event, ctx) => {
			const own = binding(ctx);
			if (!own.enabled) return;
			const turnId = randomUUID();
			this.current = { ctx, turnId };
			try {
				await register(ctx, { operation: "board-active", caller: own, turnId });
			} catch (error) {
				ctx.ui.notify(
					`Board notifications unavailable: ${String(error)}`,
					"warning",
				);
			}
		});
		const stop = async () => {
			const current = this.current;
			this.current = undefined;
			if (!current) return;
			try {
				await register(current.ctx, {
					operation: "board-active",
					caller: binding(current.ctx),
					turnId: null,
					previousTurnId: current.turnId,
				});
			} catch {
				/* No retry or delayed removal may affect a later turn. */
			}
		};
		pi.on("agent_end", stop);
		pi.on("agent_settled", stop);
		pi.on("session_shutdown", async () => {
			await stop();
			this.active.clear();
		});
		this.deliver = (request) => {
			const current = this.current;
			if (!current || current.turnId !== request.turnId || current.ctx.isIdle())
				return false;
			const own = binding(current.ctx);
			if (
				!own.enabled ||
				own.boardId !== request.boardId ||
				own.sessionId !== request.sessionId ||
				own.agentName !== request.target
			)
				return false;
			// No await between running-turn check and steering. Never use the idle kickoff.
			sendPolicyMessage(
				pi,
				{
					customType: "shepherdr-board-post",
					content: `Board post ${JSON.stringify(request.notice)}`,
					display: true,
				},
				{ deliverAs: "steer" },
			);
			return true;
		};
	}
	readonly deliver: (request: NoticeEnvelope) => boolean;
	register(caller: BoardBinding, request: ActiveEnvelope) {
		if (request.turnId)
			this.active.set(caller.agentName, {
				sessionId: caller.sessionId,
				turnId: request.turnId,
			});
		else if (
			this.active.get(caller.agentName)?.turnId === request.previousTurnId
		)
			this.active.delete(caller.agentName);
	}
}
