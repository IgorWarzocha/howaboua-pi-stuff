import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { type ActivityMessage, activityMessageTypes } from "./policy.js";

function messageKey(message: ActivityMessage): string {
	return JSON.stringify([message.customType, message.content, message.details]);
}
function replayKey(message: ActivityMessage): string {
	return JSON.stringify([message.timestamp, messageKey(message)]);
}
/** Occurrence identity survives restamping and branch rebuilds, never deduplicates arrivals. */
export class ActivityMessageIdentity {
	private messageObjects = new WeakMap<object, string>();
	private readonly messageSources = new Map<
		string,
		{ key: string; entryId?: string }
	>();
	private readonly replayMessages = new Map<string, string[]>();
	private nextMessageId = 0;
	messageId(message: ActivityMessage, live = false): string {
		const existing = this.messageObjects.get(message);
		if (existing) return existing;
		const replay = live
			? undefined
			: this.replayMessages.get(replayKey(message));
		const id = replay?.shift() ?? `message:${++this.nextMessageId}`;
		this.messageObjects.set(message, id);
		if (!this.messageSources.has(id))
			this.messageSources.set(id, { key: messageKey(message) });
		return id;
	}

	/** Persistence restamps queued messages. Bind each occurrence to its actual branch entry. */
	reconcileMessages(entries: readonly SessionEntry[]): void {
		const bound = new Set<string>();
		const pending = new Map<string, { key: string; entryId?: string }[]>();
		for (const source of this.messageSources.values()) {
			if (source.entryId !== undefined) {
				bound.add(source.entryId);
			} else {
				const matches = pending.get(source.key) ?? [];
				matches.push(source);
				pending.set(source.key, matches);
			}
		}
		// Pop in arrival order without repeatedly shifting duplicate notices.
		for (const matches of pending.values()) matches.reverse();
		for (const entry of entries) {
			if (
				entry.type !== "custom_message" ||
				!entry.display ||
				!activityMessageTypes.some((type) => type === entry.customType)
			)
				continue;
			if (bound.has(entry.id)) continue;
			const key = messageKey({
				...entry,
				timestamp: Date.parse(entry.timestamp),
			});
			const source = pending.get(key)?.pop();
			if (source) {
				source.entryId = entry.id;
				bound.add(entry.id);
			}
		}
	}

	prepareReplay(entries: readonly SessionEntry[]): void {
		this.replayMessages.clear();
		const byEntry = new Map<string, string>();
		for (const [id, source] of this.messageSources) {
			if (source.entryId !== undefined && !byEntry.has(source.entryId))
				byEntry.set(source.entryId, id);
		}
		for (const entry of entries) {
			if (entry.type !== "custom_message") continue;
			const id = byEntry.get(entry.id);
			if (!id) continue;
			const key = replayKey({
				...entry,
				timestamp: Date.parse(entry.timestamp),
			});
			const matches = this.replayMessages.get(key) ?? [];
			matches.push(id);
			this.replayMessages.set(key, matches);
		}
	}

	source(id: string) {
		return this.messageSources.get(id);
	}
	remove(id: string) {
		this.messageSources.delete(id);
	}
	reset() {
		this.messageObjects = new WeakMap();
		this.messageSources.clear();
		this.replayMessages.clear();
	}
}
