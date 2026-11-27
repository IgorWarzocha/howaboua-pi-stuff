import { isDeepStrictEqual } from "node:util";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	buildSessionProjection,
	type BeforeAgentStartEvent,
	type CustomMessageEntryDraft,
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
	type TurnEndEvent,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { hasFreshNotes } from "./fresh-notes.js";
import type { NotesLifecycle } from "./lifecycle.js";
import { isPrefixGuidanceEntry } from "./prefix-guidance.js";
import { currentRun, tailMessageKey } from "./rollover-tail.js";
import { isWindowCheckpoint } from "./window-checkpoint.js";
import { WINDOW_MESSAGE, windowDetails } from "./window-message.js";

const CHANNEL = "pi-codex-conversion:prefix-rollover:v2";
const BRANCH_CHANNEL = "pi-codex-conversion:prefix-context-branch:v2";
type Kickoff = Extract<AgentMessage, { role: "user" | "custom" }>;
type RetainedGuidance =
	| { kind: "virtual"; entryId: string }
	| {
			kind: "foreign";
			entryId: string;
			message: Extract<AgentMessage, { role: "custom" }>;
	  };
type Candidate = {
	manager: ExtensionContext["sessionManager"];
	windowId: string;
	runId: string;
	priorLeaf: string;
	trigger: BeforeAgentStartEvent["messageType"];
	kickoff?: Kickoff;
	armed?: {
		leaf: string;
		firstKeptEntryId: string;
		window: CustomMessageEntryDraft;
	};
};
interface PrefixRolloverRequest {
	protocol: 2;
	ctx: ExtensionContext;
	virtualEntryIds?: readonly string[];
	plan?: {
		kickoff: Kickoff;
		carrier: Extract<AgentMessage, { role: "custom" }>;
		recovery: CustomMessageEntryDraft & { content: string };
		retainedGuidance: readonly RetainedGuidance[];
		arm(): boolean;
	};
}
interface PrefixBranchRequest {
	protocol: 2;
	ctx: ExtensionContext;
	entries?: readonly SessionEntry[];
}

function matchesKickoff(entry: SessionEntry, kickoff: Kickoff): boolean {
	const [message] = sessionEntryToContextMessages(entry);
	if (kickoff.role === "user")
		return message?.role === "user" && isDeepStrictEqual(message, kickoff);
	// Pi timestamps the custom entry separately from the live kickoff message.
	return (
		message?.role === "custom" &&
		message.customType === kickoff.customType &&
		message.display === kickoff.display &&
		isDeepStrictEqual(message.content, kickoff.content) &&
		isDeepStrictEqual(message.details, kickoff.details)
	);
}

// Admission is provisional until the projected request yields a successful turn.
export class PrefixRollover {
	private candidate: Candidate | undefined;
	private readonly host: NotesLifecycle;
	constructor(pi: ExtensionAPI, host: NotesLifecycle) {
		this.host = host;
		const stop = pi.events.on(CHANNEL, (value) => {
			const request = value as Partial<PrefixRolloverRequest> | undefined;
			if (request?.protocol === 2 && request.ctx && !request.plan) {
				const plan = this.plan(request.ctx, request.virtualEntryIds);
				if (plan) request.plan = plan;
			}
		});
		const stopBranch = pi.events.on(BRANCH_CHANNEL, (value) => {
			const request = value as Partial<PrefixBranchRequest> | undefined;
			if (request?.protocol === 2 && request.ctx && !request.entries) {
				const manager = request.ctx.sessionManager;
				let id = manager.getLeafId();
				let active = false;
				while (id) {
					const entry = manager.getEntry(id);
					if (!entry) break;
					if (entry.type === "compaction" && !isWindowCheckpoint(entry)) break;
					const details = windowDetails(entry);
					if (details?.kind === "window" && details.trim) {
						active = details.prefixGuidance !== undefined;
						break;
					}
					id = entry.parentId;
				}
				const entries = active
					? this.host.windows.projectPrefixBranch(manager.getBranch())
					: undefined;
				if (entries) request.entries = entries;
			}
		});
		pi.on("session_shutdown", stop);
		pi.on("session_shutdown", stopBranch);
		pi.on("message_end", ({ message }, ctx) => this.messageEnd(message, ctx));
	}
	reset(): void {
		this.candidate = undefined;
	}
	capture(
		ctx: ExtensionContext,
		event: BeforeAgentStartEvent,
		runId: string,
	): void {
		this.reset();
		const windowId = this.host.windows.current?.currentWindowId;
		const priorLeaf = ctx.sessionManager.getLeafId();
		if (
			!windowId ||
			!priorLeaf ||
			!this.host.allowsPrefixRollover() ||
			(event.messageType === "custom" &&
				windowDetails({ type: "custom_message", ...event.message }))
		)
			return;
		this.candidate = {
			manager: ctx.sessionManager,
			windowId,
			runId,
			priorLeaf,
			trigger: event.messageType,
		};
	}
	private isCurrent(candidate: Candidate, ctx: ExtensionContext): boolean {
		return (
			this.candidate === candidate &&
			this.host.allowsPrefixRollover() &&
			this.host.runId === candidate.runId &&
			this.host.windows.current?.currentWindowId === candidate.windowId &&
			ctx.sessionManager === candidate.manager &&
			ctx.signal?.aborted === false
		);
	}
	private messageEnd(message: AgentMessage, ctx: ExtensionContext): void {
		const current = this.candidate;
		if (!current || current.kickoff || !this.isCurrent(current, ctx)) return;
		if (message.role === current.trigger) current.kickoff = message;
	}
	private plan(
		ctx: ExtensionContext,
		virtualEntryIds: readonly string[] = [],
	): PrefixRolloverRequest["plan"] {
		if (
			!Array.isArray(virtualEntryIds) ||
			!virtualEntryIds.every((id) => typeof id === "string" && id) ||
			new Set(virtualEntryIds).size !== virtualEntryIds.length
		)
			return;
		const current = this.candidate;
		const kickoff = current?.kickoff;
		if (!current || !kickoff || current.armed || !this.isCurrent(current, ctx))
			return;
		const branch = currentRun(ctx.sessionManager, current.runId);
		if (!branch || branch[0]?.parentId !== current.priorLeaf) return;
		// Prove the checkpoint on the exact pre-kickoff branch, only when PCC
		// has a candidate change. Most turns don't need to scan old messages.
		const all = ctx.sessionManager.getBranch();
		const prior = all.findIndex((entry) => entry.id === current.priorLeaf);
		if (prior < 0) return;
		const outgoing = all.slice(0, prior + 1);
		const terminal = outgoing.findLastIndex(
			(item) => item.type === "message" && item.message.role === "assistant",
		);
		// A carrier appended since the final response may not have been read.
		if (
			terminal < 0 ||
			outgoing
				.slice(terminal + 1)
				.some((item) => item.type === "custom_message") ||
			!hasFreshNotes(outgoing, current.windowId)
		)
			return;
		const carrierEntry = outgoing.findLast((item) => {
			if (item.type !== "custom_message" || item.customType !== WINDOW_MESSAGE)
				return false;
			const details = windowDetails(item);
			return (
				(details?.kind === "window" || details?.kind === "identity") &&
				details.identity.currentWindowId === current.windowId
			);
		});
		const carrier =
			carrierEntry && sessionEntryToContextMessages(carrierEntry)[0];
		if (carrier?.role !== "custom") return;
		const kickoffIndex = branch.findIndex((item) =>
			matchesKickoff(item, kickoff),
		);
		const entry = branch[kickoffIndex];
		if (
			!entry ||
			branch
				.slice(0, kickoffIndex)
				.some((item) =>
					sessionEntryToContextMessages(item).some(
						(message) => message.role !== "system",
					),
				) ||
			branch.some(
				(item) =>
					item.type === "compaction" ||
					(item.type === "message" &&
						item.message.role !== "system" &&
						item.message.role !== "user"),
			)
		)
			return;
		const leaf = ctx.sessionManager.getLeafId();
		if (!leaf) return;
		// Pi rebuilds requests from its session projection. Custom messages have
		// the entry timestamp there, not their live message_end timestamp.
		const [persistedKickoff] = sessionEntryToContextMessages(entry);
		if (
			persistedKickoff?.role !== "user" &&
			persistedKickoff?.role !== "custom"
		)
			return;
		const context = buildSessionProjection(
			this.host.windows.projectBranch(all),
		);
		const first = context.entries.findIndex(
			({ sourceEntry }) => sourceEntry.id === entry.id,
		);
		if (first < 0) return;
		const virtual = new Set(virtualEntryIds);
		const physicalVirtual = new Set(
			all
				.filter((item) => item.type === "custom" && virtual.has(item.id))
				.map((item) => item.id),
		);
		const retainedGuidance: RetainedGuidance[] = [];
		let virtualIndex = 0;
		for (const [
			index,
			{ sourceEntry, messages },
		] of context.entries.entries()) {
			const id = sourceEntry.id;
			if (virtual.has(id)) {
				if (!physicalVirtual.has(id) || id !== virtualEntryIds[virtualIndex++])
					return;
				if (index < first)
					retainedGuidance.push({ kind: "virtual", entryId: id });
			} else if (index < first && isPrefixGuidanceEntry(sourceEntry)) {
				const message = messages[0];
				if (message?.role !== "custom") continue;
				retainedGuidance.push({ kind: "foreign", entryId: id, message });
			}
		}
		if (virtualIndex !== virtualEntryIds.length) return;
		const window = this.host.createPrefixWindowDraft(
			ctx,
			{
				mode: "full",
				firstKeptEntryId: entry.id,
				firstMessage: tailMessageKey(persistedKickoff),
			},
			retainedGuidance.map(({ entryId }) => entryId),
		);
		if (typeof window.content !== "string" || !window.content) return;
		const recovery = { ...window, content: window.content };
		return {
			kickoff: persistedKickoff,
			carrier,
			retainedGuidance,
			recovery,
			arm: () => {
				if (
					!this.isCurrent(current, ctx) ||
					current.armed ||
					ctx.sessionManager.getLeafId() !== leaf
				)
					return false;
				current.armed = { firstKeptEntryId: entry.id, leaf, window: recovery };
				return true;
			},
		};
	}
	takeWindow(event: TurnEndEvent, ctx: ExtensionContext) {
		const current = this.candidate;
		const armed = current?.armed;
		if (!current || !armed || !this.isCurrent(current, ctx)) {
			this.reset();
			return;
		}
		this.reset();
		if (
			event.message.role !== "assistant" ||
			(event.message.stopReason !== "stop" &&
				event.message.stopReason !== "toolUse")
		)
			return;
		const branch = currentRun(ctx.sessionManager, current.runId);
		if (!branch?.some((entry) => entry.id === armed.leaf)) return;
		return { window: armed.window, firstKeptEntryId: armed.firstKeptEntryId };
	}
}
