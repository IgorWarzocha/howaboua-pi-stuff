import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import {
	sessionEntryToContextMessages,
	type CustomMessageEntryDraft,
	type ExtensionContext,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { NotesBridge, WindowIdentity } from "./bridge.js";
import {
	completeTailCalls,
	projectTailEntry,
	projectTailMessage,
	tailMessageKey,
} from "./rollover-tail.js";
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
	private nativeKeptEntry: string | undefined;
	private reminders = new Set<string>();
	restore(entries: readonly SessionEntry[]): void {
		this.current = undefined;
		this.identityEntry = undefined;
		this.compactedSinceBoundary = false;
		this.nativeKeptEntry = undefined;
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
				if (details.trim) {
					this.compactedSinceBoundary = false;
					this.nativeKeptEntry = undefined;
				}
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
			if (entry.type === "compaction" && isWindowCheckpoint(entry))
				this.nativeKeptEntry = entry.firstKeptEntryId;
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
					? renderTaskBoundaryReminder(remainingPercent)
					: `<context_window_reminder>\n${kind === "urgent" ? "Urgent: " : ""}${remainingPercent}% context left; save checkpoint via notes→new_context ${kind === "urgent" ? "now, before other work" : "before continuing work"}.\n</context_window_reminder>`,
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
			// A later Pi/PCC summary keeps its own suffix, not the original tail.
			// If that suffix still crosses a Notes boundary, keep the tail's
			// content policy on the surviving pre-boundary messages.
			const boundary = messages.findLastIndex(
				(message) =>
					message.role === "custom" &&
					messageWindowDetails(message.customType, message.details)?.trim ===
						true,
			);
			const marker = messages[boundary];
			const tail =
				marker?.role === "custom" &&
				messageWindowDetails(marker.customType, marker.details)?.tail;
			if (tail)
				messages = [
					...this.projectTailMessages(messages.slice(0, boundary), tail, true),
					...messages.slice(boundary),
				];
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
		let tail: WindowDetails["tail"];
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]!;
			if (message.role !== "custom") continue;
			const details = messageWindowDetails(message.customType, message.details);
			if (!details && message.customType === WINDOW_MESSAGE)
				throw new Error(
					"Invalid saved context window. Open an intact session branch to continue.",
				);
			if (details?.kind === "window" && details.trim) {
				boundary = i;
				tail = details.tail;
			}
		}
		if (boundary < 0) return [...messages];
		const system = getCurrentSystemMessage(messages.slice(0, boundary));
		let kept = boundary - 1;
		while (
			tail &&
			kept >= 0 &&
			tailMessageKey(messages[kept]!) !== tail.firstMessage
		)
			kept--;
		const start =
			kept >= 0
				? kept
				: tail && this.nativeKeptEntry === tail.firstKeptEntryId
					? 0
					: boundary;
		const carried = tail
			? this.projectTailMessages(messages.slice(start, boundary), tail, false)
			: [];
		return [
			...(system ? [system] : []),
			...carried,
			...messages.slice(boundary),
		];
	}
	private projectTailMessages(
		messages: readonly AgentMessage[],
		tail: NonNullable<WindowDetails["tail"]>,
		preserveSummary: boolean,
	): AgentMessage[] {
		const complete =
			tail.mode === "full" ? completeTailCalls(messages) : undefined;
		return messages.flatMap((message) => {
			if (message.role === "system" || message.role === "compactionSummary")
				return preserveSummary ? [message] : [];
			const projected = projectTailMessage(message, tail.mode, complete);
			return projected ? [projected] : [];
		});
	}
	projectBranch(entries: readonly SessionEntry[]): SessionEntry[] {
		let boundary = -1;
		let summarized = false;
		let tail: WindowDetails["tail"];
		for (let i = 0; i < entries.length; i++) {
			const details = windowDetails(entries[i]!);
			if (details?.kind === "window" && details.trim) {
				boundary = i;
				tail = details.tail;
				summarized = false;
			}
			// Normal Pi/PCC compaction has already chosen its own checkpoint.
			if (entries[i]!.type === "compaction" && !isWindowCheckpoint(entries[i]!))
				summarized = true;
		}
		let first = -1;
		if (tail)
			for (let i = boundary - 1; i >= 0; i--) {
				if (entries[i]!.id === tail.firstKeptEntryId) {
					first = i;
					break;
				}
				if (windowDetails(entries[i]!)?.trim) break;
			}
		const start = summarized ? 0 : first >= 0 ? first : Math.max(0, boundary);
		const complete =
			tail?.mode === "full" && first >= 0
				? completeTailCalls(
						entries
							.slice(first, boundary)
							.flatMap(sessionEntryToContextMessages),
					)
				: undefined;
		return entries.slice(start).map((entry, index): SessionEntry =>
			isWindowCheckpoint(entry)
				? {
						type: "custom",
						id: entry.id,
						parentId: entry.parentId,
						timestamp: entry.timestamp,
						customType: "notes-compaction:window-checkpoint",
					}
				: tail &&
					  first >= 0 &&
					  start + index >= first &&
					  start + index < boundary
					? projectTailEntry(entry, tail.mode, complete)
					: entry,
		);
	}
}
