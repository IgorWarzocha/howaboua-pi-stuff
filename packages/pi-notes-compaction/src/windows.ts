import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import type {
	CustomMessageEntryDraft,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { NotesBridge, WindowIdentity } from "./bridge.js";
import {
	renderTaskBoundaryReminder,
	taskBoundaryEligible,
} from "./task-boundary.js";
import { isWindowCheckpoint } from "./window-checkpoint.js";

import {
	messageWindowDetails,
	WINDOW_MESSAGE,
	type WindowDetails,
	windowDetails,
} from "./window-message.js";

export {
	registerWindowRenderer,
	SETTLEMENT_ENTRY,
	WINDOW_MESSAGE,
	windowDetails,
	windowMessage,
} from "./window-message.js";

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
