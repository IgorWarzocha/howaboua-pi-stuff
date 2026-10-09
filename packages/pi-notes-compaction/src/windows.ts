import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import type {
	CustomMessageEntryDraft,
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Box, Text, TruncatedText } from "@earendil-works/pi-tui";
import type { WindowIdentity } from "./bridge.js";

export const WINDOW_MESSAGE = "notes-compaction:window:v1";
export const SETTLEMENT_ENTRY = "notes-compaction:settled:v1";
export interface WindowDetails {
	protocol: 1;
	kind: "window" | "identity" | "reminder" | "urgent";
	identity: WindowIdentity;
	trim: boolean;
}
const GUIDANCE = `<context_window_guidance>
Checkpoint the active request, known history IDs, decisions, progress, learnings and next steps in notes before new_context. After rollover, read hinted notes. Use history only for a missing detail.
After substantial work, save useful findings, decisions and resumable state in notes as your last tool calls before replying. Skip brief clarifications, routine lookups, acknowledgements and unchanged state. Explicit checkpoints and reminders still apply. Include note paths in agent handoffs.
Include useful deferred ideas and tasks when checkpointing. Recording is not permission to implement.
</context_window_guidance>`;

export function registerWindowRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(
		WINDOW_MESSAGE,
		(message, { expanded, outputPad }, theme) => {
			const details = parseWindowDetails(message.details);
			if (!details || typeof message.content !== "string") return undefined;
			const title =
				details.kind === "urgent"
					? "Context nearly full · Save notes and start a new window now"
					: details.kind === "reminder"
						? "Context checkpoint reminder · Save notes and start a new window"
						: `Context window ${details.identity.windowNumber + 1} · Notes and history`;
			const box = new Box(outputPad, 1, (text) =>
				theme.bg("customMessageBg", text),
			);
			box.addChild(
				expanded
					? new Text(theme.fg("customMessageText", message.content), 0, 0)
					: new TruncatedText(
							theme.fg(
								details.kind === "urgent" ? "warning" : "customMessageLabel",
								title,
							) +
								theme.fg(
									"dim",
									` (${keyHint("app.tools.expand", "to expand")})`,
								),
							0,
							0,
						),
			);
			return box;
		},
	);
}

function identity(value: unknown): WindowIdentity | undefined {
	if (!value || typeof value !== "object") return;
	const data = value as Partial<WindowIdentity>;
	if (
		typeof data.firstWindowId !== "string" ||
		!data.firstWindowId ||
		typeof data.currentWindowId !== "string" ||
		!data.currentWindowId ||
		!Number.isInteger(data.windowNumber) ||
		data.windowNumber! < 0 ||
		(data.previousWindowId !== undefined &&
			typeof data.previousWindowId !== "string")
	)
		return;
	return data as WindowIdentity;
}

function parseWindowDetails(value: unknown): WindowDetails | undefined {
	if (!value || typeof value !== "object") return;
	const details = value as Partial<WindowDetails>;
	const ids = identity(details.identity);
	if (
		details.protocol !== 1 ||
		!ids ||
		!["window", "identity", "reminder", "urgent"].includes(
			details.kind ?? "",
		) ||
		typeof details.trim !== "boolean"
	)
		return;
	return {
		protocol: 1,
		kind: details.kind!,
		identity: ids,
		trim: details.trim,
	};
}

/** Understand previous PCC window IDs for familiar history lookup, without importing its runtime. */
export function windowDetails(entry: SessionEntry): WindowDetails | undefined {
	if (entry.type !== "custom_message") return;
	return messageWindowDetails(entry.customType, entry.details);
}

function messageWindowDetails(
	customType: string,
	data: unknown,
): WindowDetails | undefined {
	if (customType === WINDOW_MESSAGE) return parseWindowDetails(data);
	if (
		customType !== "codex-context-window" ||
		!data ||
		typeof data !== "object" ||
		!("contextManagement" in data)
	)
		return;
	const details = data.contextManagement;
	if (
		!details ||
		typeof details !== "object" ||
		!("kind" in details) ||
		details.kind !== "window"
	)
		return;
	const ids = identity(details);
	return ids
		? {
				protocol: 1,
				kind: "window",
				identity: ids,
				trim:
					"trimPreviousWindow" in details &&
					details.trimPreviousWindow === true,
			}
		: undefined;
}

export function windowMessage(
	ids: WindowIdentity,
	agent: string,
	hint: string,
	trim: boolean,
	kind: "window" | "identity" = "window",
): CustomMessageEntryDraft {
	const lines = [
		`Agent name: ${agent}`,
		`First context window id: ${ids.firstWindowId}`,
		`Current context window id: ${ids.currentWindowId}`,
	];
	if (ids.previousWindowId)
		lines.push(`Previous context window id: ${ids.previousWindowId}`);
	if (hint) lines.push(hint);
	return {
		type: "custom_message",
		customType: WINDOW_MESSAGE,
		content: `${GUIDANCE}\n\n<context_window>\n${lines.join("\n")}\n</context_window>`,
		display: true,
		details: {
			protocol: 1,
			kind,
			identity: ids,
			trim,
		} satisfies WindowDetails,
	};
}

export class Windows {
	current: WindowIdentity | undefined;
	private compactedSinceBoundary = false;
	private reminders = new Set<string>();
	restore(entries: readonly SessionEntry[]): void {
		this.current = undefined;
		this.compactedSinceBoundary = false;
		this.reminders.clear();
		for (const entry of entries) {
			const details = windowDetails(entry);
			if (details?.kind === "window") {
				this.current = details.identity;
				this.compactedSinceBoundary = false;
			} else if (
				details &&
				(details.kind === "reminder" || details.kind === "urgent")
			)
				this.reminders.add(
					`${details.identity.currentWindowId}:${details.kind}`,
				);
			if (entry.type === "compaction") {
				this.reminders.clear();
				this.compactedSinceBoundary = true;
			}
		}
	}
	next(): WindowIdentity {
		const id = randomUUID();
		return this.current
			? {
					firstWindowId: this.current.firstWindowId,
					currentWindowId: id,
					previousWindowId: this.current.currentWindowId,
					windowNumber: this.current.windowNumber + 1,
				}
			: { firstWindowId: id, currentWindowId: id, windowNumber: 0 };
	}
	remaining(ctx: ExtensionContext) {
		const usage = ctx.getContextUsage();
		const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
		const tokens = usage?.tokens;
		const remainingTokens =
			tokens === undefined ||
			tokens === null ||
			!Number.isFinite(tokens) ||
			!Number.isFinite(contextWindow) ||
			contextWindow <= 0
				? undefined
				: Math.max(0, contextWindow - Math.max(0, tokens));
		return {
			contextWindow,
			windowId: this.current?.currentWindowId,
			remainingTokens,
			remainingPercent:
				remainingTokens === undefined
					? undefined
					: Math.round((remainingTokens / contextWindow) * 1000) / 10,
		};
	}
	reminder(ctx: ExtensionContext): CustomMessageEntryDraft | undefined {
		const { remainingTokens, contextWindow, remainingPercent } =
			this.remaining(ctx);
		if (!this.current || remainingTokens === undefined) return;
		const used = 100 * (1 - remainingTokens / contextWindow);
		const kind = used >= 90 ? "urgent" : used >= 85 ? "reminder" : undefined;
		if (!kind || this.reminders.has(`${this.current.currentWindowId}:${kind}`))
			return;
		this.reminders.add(`${this.current.currentWindowId}:reminder`);
		if (kind === "urgent")
			this.reminders.add(`${this.current.currentWindowId}:urgent`);
		return {
			type: "custom_message",
			customType: WINDOW_MESSAGE,
			content: `<context_window_reminder>\n${kind === "urgent" ? "Urgent: " : ""}${remainingPercent}% remaining. Checkpoint the active request, state and known history IDs in notes, then call new_context ${kind === "urgent" ? "now, before other work" : "before continuing work"}.\n</context_window_reminder>`,
			display: true,
			details: {
				protocol: 1,
				kind,
				identity: this.current,
				trim: false,
			} satisfies WindowDetails,
		};
	}
	projectMessages(messages: readonly AgentMessage[]): AgentMessage[] {
		if (this.compactedSinceBoundary) return [...messages];
		let boundary = -1;
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]!;
			if (message.role !== "custom") continue;
			const details = messageWindowDetails(message.customType, message.details);
			if (!details && message.customType === WINDOW_MESSAGE)
				throw new Error(
					"Invalid saved context window. Open an intact session branch to continue.",
				);
			if (details?.kind === "window") boundary = details.trim ? i : -1;
		}
		if (boundary < 0) return [...messages];
		const system = getCurrentSystemMessage(messages.slice(0, boundary));
		return system
			? [system, ...messages.slice(boundary)]
			: messages.slice(boundary);
	}
	projectBranch(entries: readonly SessionEntry[]): SessionEntry[] {
		let boundary = -1;
		for (let i = 0; i < entries.length; i++) {
			const details = windowDetails(entries[i]!);
			if (details?.kind === "window") boundary = details.trim ? i : -1;
			// Normal Pi/PCC compaction has already chosen its own checkpoint.
			if (entries[i]!.type === "compaction") boundary = -1;
		}
		return entries.slice(Math.max(0, boundary));
	}
}
