import { createHash } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	SessionProjection,
} from "@earendil-works/pi-coding-agent";

interface NotesProjection {
	identity(ctx: ExtensionContext): { currentWindowId: string } | undefined;
	projectMessages(
		messages: SessionProjection["messages"],
		entries: readonly SessionEntry[],
	): SessionProjection["messages"];
	projectBranch(entries: readonly SessionEntry[]): SessionEntry[];
}

interface ConversationTurn {
	key: string;
	role: "user" | "assistant";
	text: string;
}

export interface ConversationSnapshot {
	window: string;
	turns: ConversationTurn[];
	summary?: string;
	ready: boolean;
}

export function isHumanTui(pi: ExtensionAPI, ctx: ExtensionContext): boolean {
	if (ctx.mode !== "tui") return false;
	let worker = false;
	pi.events.emit("shepherdr:worker-role:v1", {
		sessionManager: ctx.sessionManager,
		reply: (value: boolean) => {
			worker ||= value === true;
		},
	});
	return !worker;
}

export function conversationSnapshot(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): ConversationSnapshot {
	let owner: NotesProjection | undefined;
	pi.events.emit("pi-notes-compaction:owner:v1", {
		protocol: 1,
		ctx,
		// Projection remains authoritative even when Notes is switched off.
		projection: (value: NotesProjection) => {
			owner = value;
		},
	});
	const branch = ctx.sessionManager.getBranch();
	const projection = ctx.sessionManager.buildSessionProjection();
	// Refresh the owner's identity from this branch before reading it. A Notes
	// window can advance without trimming history or creating a Pi compaction.
	owner?.projectMessages(projection.messages, branch);
	const notesWindow = owner?.identity(ctx)?.currentWindowId;
	const visible = owner ? owner.projectBranch(branch) : branch;
	const ids = new Set(visible.map((entry) => entry.id));
	const entries = projection.entries.filter((entry) =>
		ids.has(entry.sourceEntry.id),
	);
	const messages = entries.flatMap((entry) => entry.messages);
	const latest = messages.findLast((message) => message.role === "assistant");
	const turns: ConversationTurn[] = [];
	for (const entry of entries) {
		for (const [index, message] of entry.messages.entries()) {
			if (message.role !== "user" && message.role !== "assistant") continue;
			if (message.role === "assistant" && message.stopReason !== "stop")
				continue;
			const text =
				typeof message.content === "string"
					? message.content
					: message.content
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join("\n");
			if (!text.trim()) continue;
			turns.push({
				key: `${entry.sourceEntry.id}:${index}:${createHash("sha256").update(text).digest("hex")}`,
				role: message.role,
				text:
					text.length <= 3000
						? text
						: message.role === "user"
							? `${text.slice(0, 3000)} [truncated]`
							: `[truncated] ${text.slice(-3000)}`,
			});
		}
	}
	const summary = messages.findLast(
		(message) => message.role === "compactionSummary",
	);
	return {
		window: JSON.stringify([
			ctx.sessionManager.getSessionId(),
			notesWindow,
			visible[0]?.id,
			visible.findLast((entry) => entry.type === "compaction")?.id,
		]),
		turns,
		...(summary?.role === "compactionSummary"
			? { summary: summary.summary.slice(0, 3000) }
			: {}),
		ready:
			latest?.role === "assistant" &&
			latest.stopReason === "stop" &&
			latest.content.some(
				(part) => part.type === "text" && !!part.text.trim(),
			) &&
			turns.some((turn) => turn.role === "user"),
	};
}

export function conversationUpdate(
	snapshot: ConversationSnapshot,
	seen: number,
): string {
	let turns = snapshot.turns.slice(seen);
	if (seen === 0) {
		turns = turns.slice(-10);
		let remaining = 16000;
		turns = turns
			.reverse()
			.flatMap((turn) => {
				if (remaining <= 0) return [];
				const text =
					turn.role === "user"
						? turn.text.slice(0, remaining)
						: turn.text.slice(-remaining);
				remaining -= text.length;
				return [{ ...turn, text }];
			})
			.reverse();
	}
	return `${seen === 0 ? "Conversation" : "New conversation turns (previous suggestions were drafts, not sent messages)"}:\n${JSON.stringify(
		{
			...(seen === 0 && snapshot.summary
				? { earlierSummary: snapshot.summary }
				: {}),
			turns: turns.map(({ role, text }) => ({ role, text })),
		},
	)}\n\nDraft the next request from the user to the assistant:`;
}
