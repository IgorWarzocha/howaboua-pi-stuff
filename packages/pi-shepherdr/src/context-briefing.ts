import { randomUUID } from "node:crypto";
import {
	buildSessionContext,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	CODEX_CONTEXT_BRIEFING_TYPE,
	CodexContextBriefing,
	CodexContextBriefingHandler,
} from "@howaboua/pi-codex-conversion/developer-messages";
import { registerInferenceBriefing } from "./delivery.js";

// Conversion projects this durable protocol in inference, compaction and native replay.
const BRIEFING: typeof CODEX_CONTEXT_BRIEFING_TYPE = "codex-context-briefing";

export function registerContextBriefing(
	pi: ExtensionAPI,
	name: string,
	relevant: (ctx: ExtensionContext) => boolean,
	record: CodexContextBriefingHandler,
) {
	const hosted = registerInferenceBriefing(pi, record);
	const warned = new Set<string>();
	pi.on("context_with_system", async (event, ctx) => {
		if (hosted.hosted()) return;
		if (
			hosted.outdated &&
			relevant(ctx) &&
			!warned.has(ctx.sessionManager.getSessionId())
		) {
			warned.add(ctx.sessionManager.getSessionId());
			ctx.ui.notify(
				`Update Codex Conversion and reload to preserve ${name} briefings through its context rollover and native replay. Native Pi briefings and other agent tools remain available.`,
				"warning",
			);
		}
		try {
			await record(ctx, undefined, event.messages);
			return { messages: projectNative(ctx, event.messages) };
		} catch (error) {
			ctx.abort();
			throw error;
		}
	});
}

export function contextBriefingWindow(
	ctx: ExtensionContext,
	windowId?: string,
) {
	const branch = ctx.sessionManager.getBranch();
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
	return compaction > boundary
		? branch[compaction]!.id
		: (windowId ?? ctx.sessionManager.getSessionId());
}

export async function recordContextBriefing(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	owner: string,
	key: string,
	content: () => Promise<string | undefined>,
) {
	const saved = ctx.sessionManager
		.getEntries()
		.findLast(
			(entry) =>
				entry.type === "custom" &&
				entry.customType === BRIEFING &&
				readBriefing(entry.data).owner === owner &&
				readBriefing(entry.data).key === key,
		);
	if (saved?.type === "custom") {
		// Tree may select an ancestor before its metadata child. Reuse immutable bytes/ID.
		if (
			!ctx.sessionManager
				.getBranch()
				.some(
					(entry) =>
						entry.type === "custom" &&
						entry.customType === BRIEFING &&
						readBriefing(entry.data).owner === owner &&
						readBriefing(entry.data).key === key,
				)
		)
			pi.appendEntry(BRIEFING, readBriefing(saved.data));
		return;
	}
	const value = await content();
	if (value === undefined) return;
	pi.appendEntry(BRIEFING, {
		protocol: 1,
		id: randomUUID(),
		owner,
		key,
		content: value,
	} satisfies CodexContextBriefing);
}

function projectNative(
	ctx: ExtensionContext,
	messages: NativeMessage[],
): NativeMessage[] {
	const entries = ctx.sessionManager.getBranch().map((entry) => {
		if (entry.type !== "custom" || entry.customType !== BRIEFING) return entry;
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
		insertions.set(position, [...(insertions.get(position) ?? []), ...pending]);
		pending = [];
	};
	for (const message of reconstructed) {
		const index = positions.get(messageKey(message))?.shift();
		if (index !== undefined) {
			insert(index);
			last = index;
		} else if (message.role === "custom" && message.customType === BRIEFING) {
			pending.push(message);
		}
	}
	insert(last + 1);
	return messages
		.flatMap((message, index) => [...(insertions.get(index) ?? []), message])
		.concat(insertions.get(messages.length) ?? []);
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
