import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

export const CODEX_CONTEXT_BRIEFING_TYPE = "codex-context-briefing";
const CHANNEL = "@howaboua/pi-codex-conversion/context-briefings/v1";

/** Persist with pi.appendEntry(CODEX_CONTEXT_BRIEFING_TYPE, briefing). IDs and content are immutable. */
export interface CodexContextBriefing {
	protocol: 1;
	id: string;
	owner: string;
	key: string;
	content: string;
}

export type CodexContextBriefingHandler = (ctx: ExtensionContext, windowId: string | undefined) => Promise<void>;
type Request = { protocol: 1; action: "available"; available?: boolean }
	| { protocol: 1; action: "record"; ctx: ExtensionContext; windowId: string | undefined; pending: Promise<void>[] };

/** Callbacks run at actual inference admission, before durable context projection. */
export function registerCodexContextBriefing(pi: ExtensionAPI, handler: CodexContextBriefingHandler): () => void {
	return pi.events.on(CHANNEL, (value) => {
		const request = value as Request;
		if (request?.protocol === 1 && request.action === "record")
			request.pending.push(handler(request.ctx, request.windowId));
	});
}

export function hasCodexContextBriefingHost(pi: ExtensionAPI): boolean {
	const request: Request = { protocol: 1, action: "available" };
	pi.events.emit(CHANNEL, request);
	return request.available === true;
}

export function registerCodexContextBriefingHost(pi: ExtensionAPI): () => void {
	return pi.events.on(CHANNEL, (value) => {
		const request = value as Request;
		if (request?.protocol === 1 && request.action === "available") request.available = true;
	});
}

export async function recordCodexContextBriefings(pi: ExtensionAPI, ctx: ExtensionContext, windowId: string | undefined): Promise<void> {
	const request: Request = { protocol: 1, action: "record", ctx, windowId, pending: [] };
	pi.events.emit(CHANNEL, request);
	await Promise.all(request.pending);
}

export function readCodexContextBriefing(value: unknown): CodexContextBriefing {
	if (!value || typeof value !== "object" || !("protocol" in value) || value.protocol !== 1
		|| !("id" in value) || typeof value.id !== "string" || !value.id
		|| !("owner" in value) || typeof value.owner !== "string" || !value.owner
		|| !("key" in value) || typeof value.key !== "string" || !value.key
		|| !("content" in value) || typeof value.content !== "string" || !value.content.trim())
		throw new Error("Malformed persisted context briefing");
	return value as CodexContextBriefing;
}

export function projectCodexContextBriefing(entry: SessionEntry): SessionEntry {
	if (entry.type !== "custom" || entry.customType !== CODEX_CONTEXT_BRIEFING_TYPE) return entry;
	const briefing = readCodexContextBriefing(entry.data);
	return { ...entry, type: "custom_message", content: briefing.content, display: false, details: briefing };
}
