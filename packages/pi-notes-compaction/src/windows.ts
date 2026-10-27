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
import type { NotesBridge, WindowIdentity } from "./bridge.js";
import {
	renderTaskBoundaryReminder,
	taskBoundaryEligible,
} from "./task-boundary.js";
import { isWindowCheckpoint } from "./window-checkpoint.js";

export const WINDOW_MESSAGE = "notes-compaction:window:v1";
export const SETTLEMENT_ENTRY = "notes-compaction:settled:v1";
export interface WindowDetails {
	protocol: 1;
	kind: "window" | "identity" | "reminder" | "urgent" | "task-boundary";
	identity: WindowIdentity;
	trim: boolean;
}
const GUIDANCE = `<context_window_guidance>
Notes are recovery state, not a diary. Write checkpoints and reports to relative paths in your own notes. Delegates do likewise and return their note paths. Keep one concise, authoritative note per task or topic at a stable path. Task checkpoints cover request, constraints, decisions, status, next steps and history IDs. Use write_file to replace stale state and mark completion. Link to existing notes instead of copying or summarising their contents. Recording isn't permission to implement.

Batch saves at meaningful milestones, not every reply or intermediate step. Before new_context or handoff, save current state and wait for success; include the checkpoint path in handoffs. After rollover, read the checkpoint, then only needed links. Don't reread notes still in context unless they may have changed. Use history for missing details.

Previous skill reads don’t carry into this window. Read the skills needed for the current task.
</context_window_guidance>`;

const GPT_GUIDANCE = `<context_window_guidance>
Notes=recovery state≠diary. Checkpoints/reports→write relative paths in own notes. Delegates→same→return note paths. One concise authoritative note per task/topic, stable path. Task checkpoint=request/constraints/decisions/status/next steps/history IDs. write_file→replace stale state; mark completion. Existing notes→link≠copy/summarise. Recording≠implementation permission.

Batch saves@meaningful milestones≠every reply/step. Before new_context/handoff: save current state→await success; handoff includes checkpoint path. Post-rollover: read checkpoint→needed links only. In-context notes: reread only if possibly changed. Missing details→history.

Prior skill reads≠current context. Read task-relevant skills.
</context_window_guidance>`;

export function registerWindowRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(
		WINDOW_MESSAGE,
		(message, { expanded, outputPad }, theme) => {
			const details = parseWindowDetails(message.details);
			if (!details || typeof message.content !== "string") return undefined;
			const title =
				details.kind === "task-boundary"
					? "Task-boundary reminder"
					: details.kind === "urgent"
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
		!["window", "identity", "reminder", "urgent", "task-boundary"].includes(
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
export function windowDetails(
	entry: SessionEntry | CustomMessageEntryDraft,
): WindowDetails | undefined {
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
		(details.kind !== "window" && details.kind !== "task-boundary")
	)
		return;
	const ids = identity(details);
	return ids
		? {
				protocol: 1,
				kind: details.kind,
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
	gpt = false,
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
		content: `${gpt ? GPT_GUIDANCE : GUIDANCE}\n\n<context_window>\n${lines.join("\n")}\n</context_window>`,
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
	private identityEntry:
		| Extract<SessionEntry, { type: "custom_message" }>
		| undefined;
	private restoredIdentity:
		| {
				entryId: string;
				timestamp: number;
				prepare: NotesBridge["prepareReminder"];
				message: AgentMessage;
		  }
		| undefined;
	private compactedSinceBoundary = false;
	private reminders = new Set<string>();
	restore(entries: readonly SessionEntry[]): void {
		this.current = undefined;
		this.identityEntry = undefined;
		this.compactedSinceBoundary = false;
		this.reminders.clear();
		for (const entry of entries) {
			const details = windowDetails(entry);
			if (
				entry.type === "custom_message" &&
				(details?.kind === "window" || details?.kind === "identity")
			)
				this.identityEntry = entry;
			if (details?.kind === "window") {
				this.current = details.identity;
				if (details.trim) this.compactedSinceBoundary = false;
			} else if (
				details &&
				(details.kind === "reminder" ||
					details.kind === "urgent" ||
					details.kind === "task-boundary")
			)
				this.reminders.add(
					`${details.identity.currentWindowId}:${details.kind}`,
				);
			if (entry.type === "compaction" && !isWindowCheckpoint(entry)) {
				// Compaction frees capacity, but does not create a new window identity.
				this.reminders = new Set(
					[...this.reminders].filter((key) => key.endsWith(":task-boundary")),
				);
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
	reminder(
		ctx: ExtensionContext,
		taskBoundaryReminder = 0,
		checkpointReminder = true,
		gpt = false,
	): CustomMessageEntryDraft | undefined {
		const { remainingTokens, contextWindow, remainingPercent } =
			this.remaining(ctx);
		if (
			!this.current ||
			remainingTokens === undefined ||
			remainingPercent === undefined
		)
			return;
		const used = 100 * (1 - remainingTokens / contextWindow);
		let kind: WindowDetails["kind"] | undefined = checkpointReminder
			? used >= 90
				? "urgent"
				: used >= 85
					? "reminder"
					: undefined
			: undefined;
		if (kind && this.reminders.has(`${this.current.currentWindowId}:${kind}`))
			kind = undefined;
		if (
			!kind &&
			taskBoundaryReminder &&
			!this.reminders.has(`${this.current.currentWindowId}:task-boundary`) &&
			taskBoundaryEligible(ctx, taskBoundaryReminder)
		)
			kind = "task-boundary";
		if (!kind) return;
		this.reminders.add(`${this.current.currentWindowId}:${kind}`);
		if (kind === "urgent")
			this.reminders.add(`${this.current.currentWindowId}:reminder`);
		return {
			type: "custom_message",
			customType: WINDOW_MESSAGE,
			content:
				kind === "task-boundary"
					? renderTaskBoundaryReminder(remainingPercent, gpt)
					: gpt
						? `<context_window_reminder>\n${kind === "urgent" ? "Urgent: " : ""}${remainingPercent}% context left; save task state via notes→new_context ${kind === "urgent" ? "now, before other work" : "before continuing work"}.\n</context_window_reminder>`
						: `<context_window_reminder>\n${kind === "urgent" ? "Urgent: " : ""}${remainingPercent}% context remaining. Save the task state in notes, then call new_context ${kind === "urgent" ? "now, before other work" : "before continuing work"}.\n</context_window_reminder>`,
			display: true,
			details: {
				protocol: 1,
				kind,
				identity: this.current,
				trim: false,
			} satisfies WindowDetails,
		};
	}
	projectMessages(
		messages: readonly AgentMessage[],
		prepareIdentity?: NotesBridge["prepareReminder"],
	): AgentMessage[] {
		if (this.compactedSinceBoundary) {
			const summary = messages.findIndex(
				(message) => message.role === "compactionSummary",
			);
			const entry = this.identityEntry;
			const details = entry && windowDetails(entry);
			const hasIdentity = messages.some((message) => {
				const current =
					message.role === "custom" &&
					messageWindowDetails(message.customType, message.details);
				return (
					current &&
					(current.kind === "window" || current.kind === "identity") &&
					current.identity.currentWindowId === this.current?.currentWindowId
				);
			});
			if (
				summary < 0 ||
				messages[0]?.role !== "system" ||
				!entry ||
				!details ||
				typeof entry.content !== "string" ||
				hasIdentity
			)
				return [...messages];
			const timestamp = messages[summary]!.timestamp;
			if (
				this.restoredIdentity?.entryId !== entry.id ||
				this.restoredIdentity.timestamp !== timestamp ||
				this.restoredIdentity.prepare !== prepareIdentity
			) {
				const draft: CustomMessageEntryDraft = {
					type: "custom_message",
					customType: WINDOW_MESSAGE,
					content: `${entry.content}\n\nIf no checkpoint is available, use history to recover missing context.`,
					display: false,
					details: {
						...details,
						kind: "identity",
						trim: false,
					} satisfies WindowDetails,
				};
				const prepared = prepareIdentity?.(draft) ?? draft;
				this.restoredIdentity = {
					entryId: entry.id,
					timestamp,
					prepare: prepareIdentity,
					message: {
						role: "custom",
						customType: prepared.customType,
						content: prepared.content,
						display: prepared.display,
						details: prepared.details,
						timestamp,
					},
				};
			}
			// Carry the older identity ahead of its summary, outside opaque native replay.
			return [
				...messages.slice(0, summary),
				this.restoredIdentity.message,
				...messages.slice(summary),
			];
		}
		let boundary = -1;
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]!;
			if (message.role !== "custom") continue;
			const details = messageWindowDetails(message.customType, message.details);
			if (!details && message.customType === WINDOW_MESSAGE)
				throw new Error(
					"Invalid saved context window. Open an intact session branch to continue.",
				);
			if (details?.kind === "window" && details.trim) boundary = i;
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
			if (details?.kind === "window" && details.trim) boundary = i;
			// Normal Pi/PCC compaction has already chosen its own checkpoint.
			if (entries[i]!.type === "compaction" && !isWindowCheckpoint(entries[i]!))
				boundary = -1;
		}
		return entries.slice(Math.max(0, boundary)).map(
			(entry): SessionEntry =>
				isWindowCheckpoint(entry)
					? {
							type: "custom",
							id: entry.id,
							parentId: entry.parentId,
							timestamp: entry.timestamp,
							customType: "notes-compaction:window-checkpoint",
						}
					: entry,
		);
	}
}
