import { randomUUID } from "node:crypto";
import {
	buildSessionContext,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	CODEX_CONTEXT_BRIEFING_TYPE,
	CodexContextBriefing,
} from "@howaboua/pi-codex-conversion/developer-messages";
import { registerInferenceBriefing } from "../delivery.js";
import { boardBriefing } from "../messages.js";
import { binding } from "./identity.js";

// Conversion projects this durable protocol in inference, compaction and native replay.
const BRIEFING: typeof CODEX_CONTEXT_BRIEFING_TYPE = "codex-context-briefing";
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
	constructor(
		pi: ExtensionAPI,
		read: (ctx: ExtensionContext) => Promise<unknown>,
	) {
		this.pi = pi;
		this.read = read;
		const hosted = registerInferenceBriefing(pi, (ctx, windowId) =>
			this.record(ctx, windowId),
		);
		const warned = new Set<string>();
		pi.on("context_with_system", async (event, ctx) => {
			if (hosted.hosted()) return;
			if (
				hosted.outdated &&
				binding(ctx).enabled &&
				!warned.has(ctx.sessionManager.getSessionId())
			) {
				warned.add(ctx.sessionManager.getSessionId());
				ctx.ui.notify(
					"Update Codex Conversion and reload to preserve board briefings through its context rollover and native replay. Native Pi briefings and other agent tools remain available.",
					"warning",
				);
			}
			try {
				await this.record(ctx);
				return { messages: this.projectNative(ctx, event.messages) };
			} catch (error) {
				ctx.abort();
				throw error;
			}
		});
	}

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

	private async record(ctx: ExtensionContext, windowId?: string) {
		const own = binding(ctx);
		const state = this.refresh(ctx);
		if (!own.enabled) return;
		const branch = ctx.sessionManager.getBranch();
		// Real Pi compaction opens a window even when Conversion context management is off.
		const compaction = branch.findLastIndex(
			(entry) =>
				entry.type === "compaction" &&
				!(
					entry.details &&
					typeof entry.details === "object" &&
					"strategy" in entry.details &&
					entry.details.strategy === "codex-context-window"
				),
		);
		const boundary = branch.findLastIndex(
			(entry) =>
				entry.type === "custom_message" &&
				entry.customType === "codex-context-window" &&
				entry.details &&
				typeof entry.details === "object" &&
				"contextManagement" in entry.details &&
				entry.details.contextManagement &&
				typeof entry.details.contextManagement === "object" &&
				"kind" in entry.details.contextManagement &&
				entry.details.contextManagement.kind === "window",
		);
		const window =
			compaction > boundary
				? branch[compaction]!.id
				: (windowId ?? own.sessionId);
		const key = JSON.stringify([own.sessionId, window, state.epoch]);
		const saved = ctx.sessionManager
			.getEntries()
			.findLast(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === BRIEFING &&
					readBriefing(entry.data).owner === OWNER &&
					readBriefing(entry.data).key === key,
			);
		if (saved?.type === "custom") {
			// A Tree return can select an ancestor before its metadata child. Reuse the
			// same immutable briefing, without resampling or creating a new briefing ID.
			if (
				!branch.some(
					(entry) =>
						entry.type === "custom" &&
						entry.customType === BRIEFING &&
						readBriefing(entry.data).key === key,
				)
			)
				this.pi.appendEntry(BRIEFING, readBriefing(saved.data));
			return;
		}
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
		} catch (error) {
			ctx.signal?.throwIfAborted();
			population = "unavailable";
			ctx.ui.notify(`Board status unavailable: ${String(error)}`, "warning");
		}
		ctx.signal?.throwIfAborted();
		if (!binding(ctx).enabled) return;
		if (
			binding(ctx).enabled !== own.enabled ||
			this.refresh(ctx).epoch !== state.epoch
		)
			throw new Error("Board membership changed during its briefing");
		this.pi.appendEntry(BRIEFING, {
			protocol: 1,
			id: randomUUID(),
			owner: OWNER,
			key,
			content: boardBriefing(Boolean(own.upstream), population),
		} satisfies CodexContextBriefing);
	}

	private projectNative(
		ctx: ExtensionContext,
		messages: NativeMessage[],
	): NativeMessage[] {
		const entries = ctx.sessionManager.getBranch().map((entry) => {
			if (entry.type !== "custom" || entry.customType !== BRIEFING)
				return entry;
			const briefing = readBriefing(entry.data);
			return {
				...entry,
				type: "custom_message" as const,
				content: briefing.content,
				display: false,
				details: briefing,
			};
		});
		const reconstructed = buildSessionContext(entries).messages;
		const positions = new Map<string, number[]>();
		messages.forEach((message, index) => {
			const key = messageKey(message);
			const indices = positions.get(key) ?? [];
			indices.push(index);
			positions.set(key, indices);
		});
		const insertions = new Map<number, NativeMessage[]>();
		let pending: NativeMessage[] = [];
		let last = messages[0]?.role === "system" ? 0 : -1;
		const insert = (index: number) => {
			if (!pending.length) return;
			const position =
				messages[0]?.role === "system" ? Math.max(1, index) : index;
			insertions.set(position, [
				...(insertions.get(position) ?? []),
				...pending,
			]);
			pending = [];
		};
		for (const message of reconstructed) {
			const index = positions.get(messageKey(message))?.shift();
			if (index !== undefined) {
				insert(index);
				last = index;
			} else if (message.role === "custom" && message.customType === BRIEFING)
				pending.push(message);
		}
		insert(last + 1);
		return messages
			.flatMap((message, index) => [...(insertions.get(index) ?? []), message])
			.concat(insertions.get(messages.length) ?? []);
	}
}

type NativeMessage = ReturnType<typeof buildSessionContext>["messages"][number];
function messageKey(message: NativeMessage) {
	return JSON.stringify([
		message.role,
		message.timestamp,
		message.role === "custom"
			? message.customType === BRIEFING
				? readBriefing(message.details).id
				: message.customType
			: message.role === "toolResult"
				? message.toolCallId
				: undefined,
	]);
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
function readBriefing(value: unknown): CodexContextBriefing {
	if (
		!value ||
		typeof value !== "object" ||
		!("protocol" in value) ||
		value.protocol !== 1 ||
		!("id" in value) ||
		typeof value.id !== "string" ||
		!("owner" in value) ||
		typeof value.owner !== "string" ||
		!("key" in value) ||
		typeof value.key !== "string" ||
		!("content" in value) ||
		typeof value.content !== "string"
	)
		throw new Error("Invalid saved context briefing");
	return value as CodexContextBriefing;
}
