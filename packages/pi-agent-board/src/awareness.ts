import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { boardBriefing } from "./briefing.js";
import {
	contextBriefingWindow,
	recordContextBriefing,
	registerContextBriefing,
} from "./context-briefing.js";
import { binding } from "./identity.js";

const OWNER = "shepherdr-board";
const STATE = "shepherdr-board-awareness";
interface AwarenessState {
	sessionId: string;
	signature: string;
	epoch: string;
}

/** Board state is sampled once per selected window/membership, never on a timer. */
export class BoardAwareness {
	private readonly pi: ExtensionAPI;
	private readonly read: (ctx: ExtensionContext) => Promise<unknown>;
	private readonly availability: (
		ctx: ExtensionContext,
		error?: unknown,
	) => void;
	constructor(
		pi: ExtensionAPI,
		read: (ctx: ExtensionContext) => Promise<unknown>,
		availability: (ctx: ExtensionContext, error?: unknown) => void,
		privateBriefing: () => typeof boardBriefing | undefined,
	) {
		this.pi = pi;
		this.read = read;
		this.availability = availability;
		this.privateBriefing = privateBriefing;
		registerContextBriefing(
			pi,
			"board",
			(ctx) => binding(ctx).enabled,
			(ctx, windowId) => this.record(ctx, windowId),
		);
	}
	private readonly privateBriefing: () => typeof boardBriefing | undefined;

	refresh(ctx: ExtensionContext): AwarenessState {
		const own = binding(ctx);
		const signature = JSON.stringify([
			own.boardId,
			own.rootSessionId,
			own.agentName,
			own.upstream,
			own.enabled,
		]);
		const saved = ctx.sessionManager
			.getEntries()
			.findLast(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === STATE &&
					readState(entry.data).sessionId === own.sessionId,
			);
		if (saved?.type === "custom") {
			const state = readState(saved.data);
			if (state.signature === signature) return state;
		}
		const state = { sessionId: own.sessionId, signature, epoch: randomUUID() };
		this.pi.appendEntry(STATE, state);
		return state;
	}
	seen(ctx: ExtensionContext): string[] {
		const own = binding(ctx);
		return ctx.sessionManager.getEntries().flatMap((entry) => {
			if (
				entry.type !== "custom" ||
				entry.customType !== "shepherdr-board-seen"
			)
				return [];
			const data = entry.data as {
				boardId?: string;
				agentName?: string;
				ids?: unknown;
			};
			return data?.boardId === own.boardId &&
				data.agentName === own.agentName &&
				Array.isArray(data.ids)
				? data.ids.filter((id): id is string => typeof id === "string")
				: [];
		});
	}
	markSeen(ctx: ExtensionContext, ids: string[]) {
		if (!ids.length) return;
		const own = binding(ctx);
		this.pi.appendEntry("shepherdr-board-seen", {
			boardId: own.boardId,
			agentName: own.agentName,
			ids,
		});
	}
	markRead(ctx: ExtensionContext, value: unknown) {
		if (!value || typeof value !== "object") return;
		const record = value as {
			message_id?: unknown;
			root_post?: unknown;
			results?: unknown;
		};
		const posts = [
			record,
			record.root_post,
			...(Array.isArray(record.results) ? record.results : []),
		];
		this.markSeen(
			ctx,
			posts.flatMap((post) =>
				post &&
				typeof post === "object" &&
				"message_id" in post &&
				typeof post.message_id === "string"
					? [post.message_id]
					: [],
			),
		);
	}

	private async record(ctx: ExtensionContext, windowId?: string) {
		const own = binding(ctx);
		const state = this.refresh(ctx);
		if (!own.enabled) return;
		const window = contextBriefingWindow(ctx, windowId);
		const key = JSON.stringify([own.sessionId, window, state.epoch]);
		await recordContextBriefing(this.pi, ctx, OWNER, key, async () => {
			let population: "empty" | "populated" | "unavailable";
			try {
				const value = await this.read(ctx);
				if (!binding(ctx).enabled) return;
				if (
					!value ||
					typeof value !== "object" ||
					!("results" in value) ||
					!Array.isArray(value.results)
				)
					throw new Error("Invalid board population response");
				population = value.results.length ? "populated" : "empty";
				this.availability(ctx);
			} catch (error) {
				ctx.signal?.throwIfAborted();
				population = "unavailable";
				this.availability(ctx, error);
			}
			ctx.signal?.throwIfAborted();
			if (!binding(ctx).enabled) return;
			if (
				binding(ctx).enabled !== own.enabled ||
				this.refresh(ctx).epoch !== state.epoch
			)
				throw new Error("Board membership changed during its briefing");
			return (this.privateBriefing() ?? boardBriefing)(
				Boolean(own.upstream),
				population,
			);
		});
	}
}

function readState(value: unknown): AwarenessState {
	if (
		!value ||
		typeof value !== "object" ||
		!("sessionId" in value) ||
		typeof value.sessionId !== "string" ||
		!("signature" in value) ||
		typeof value.signature !== "string" ||
		!("epoch" in value) ||
		typeof value.epoch !== "string"
	)
		throw new Error("Invalid saved board awareness");
	return value as AwarenessState;
}
