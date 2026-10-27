import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { binding, saveBinding } from "../identity.js";
import type { BoardAdapter } from "../integration.js";
import { type BoardEnvelope, parseEnvelope } from "../protocol.js";
import type { BoardOwner } from "./owner.js";
import type { BoardTurns } from "./turns.js";

/** Routes membership/setting/notice envelopes; lifecycle refresh stays with the runtime. */
export class BoardRouting {
	private readonly pi: ExtensionAPI;
	private readonly turns: BoardTurns;
	private readonly owner: BoardOwner;
	private readonly refresh: (ctx: ExtensionContext) => Promise<void>;
	private readonly reportAvailability: (
		ctx: ExtensionContext,
		error?: unknown,
	) => void;
	adapter: BoardAdapter | undefined;
	constructor(
		pi: ExtensionAPI,
		turns: BoardTurns,
		owner: BoardOwner,
		refresh: (ctx: ExtensionContext) => Promise<void>,
		reportAvailability: (ctx: ExtensionContext, error?: unknown) => void,
	) {
		this.pi = pi;
		this.turns = turns;
		this.owner = owner;
		this.refresh = refresh;
		this.reportAvailability = reportAvailability;
	}
	async handle(
		ctx: ExtensionContext,
		value: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		const request = parseEnvelope(value);
		const own = binding(ctx);
		if (request.operation === "board-bind") {
			if (
				!ctx.isIdle() ||
				ctx.sessionManager
					.getEntries()
					.some(
						(entry) =>
							(entry.type === "message" &&
								["user", "assistant"].includes(entry.message.role)) ||
							(entry.type === "custom" &&
								entry.customType === "shepherdr-board-binding"),
					)
			)
				throw new Error(
					"Bind board identity only in a fresh idle child before its first task",
				);
			const adopted = { ...request.binding, sessionId: own.sessionId };
			saveBinding(this.pi, adopted);
			await this.refresh(ctx);
			return adopted;
		}
		if (request.operation === "board-enabled") {
			if (!own.upstream || request.boardId !== own.boardId)
				throw new Error("Invalid board setting route");
			saveBinding(this.pi, { ...own, enabled: request.enabled });
			await this.refresh(ctx);
			await this.propagateEnabled(ctx, request.enabled);
			return true;
		}
		if (request.operation === "board-notify") {
			if (!own.enabled || request.boardId !== own.boardId) return false;
			if (request.target === own.agentName) return this.turns.deliver(request);
			return this.routeNotice(ctx, request, signal);
		}
		return this.toOwner(ctx, request, signal);
	}
	async toOwner(
		ctx: ExtensionContext,
		request: BoardEnvelope,
		signal?: AbortSignal,
	): Promise<unknown> {
		const own = binding(ctx);
		if (own.upstream) {
			try {
				const result = await this.requireAdapter().request(
					own.upstream,
					request,
					signal,
				);
				this.reportAvailability(ctx);
				return result;
			} catch (error) {
				if (
					error instanceof Error &&
					error.message.startsWith("Shared context response was lost")
				)
					throw new Error(
						"Board response lost; a mutation may have completed. Read the channel/thread before retrying",
						{ cause: error },
					);
				if (
					error instanceof Error &&
					error.message.startsWith("Shared context owner is unavailable")
				)
					throw new Error(
						"Board owner unavailable; resume its Pi session and reconnect its machine",
						{ cause: error },
					);
				throw error;
			}
		}
		return this.owner.execute(ctx, request);
	}

	private async routeNotice(
		ctx: ExtensionContext,
		request: Extract<BoardEnvelope, { operation: "board-notify" }>,
		signal?: AbortSignal,
	) {
		return this.requireAdapter().routeNotice(ctx, request, signal);
	}
	async propagateEnabled(ctx: ExtensionContext, enabled: boolean) {
		await this.adapter?.propagateEnabled(ctx, enabled);
	}
	attach(adapter: BoardAdapter) {
		if (this.adapter) throw new Error("Board integration already attached");
		this.adapter = adapter;
	}
	requireAdapter() {
		if (!this.adapter)
			throw new Error(
				"Board member route unavailable; load the extension that manages this session's board membership",
			);
		return this.adapter;
	}
}
