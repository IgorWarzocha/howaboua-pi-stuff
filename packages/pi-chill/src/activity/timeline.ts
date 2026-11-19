import type {
	CustomEntry,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { type ActivityCall, ActivityGroup } from "./group.js";
import { ActivityMessageIdentity } from "./message-identity.js";
import type { ActivityMessage } from "./policy.js";
import { replayActivity } from "./replay.js";

export class ActivityTimeline {
	// Pi can rebuild entry components around the same persisted object.
	renderGeneration = 0;
	readonly messages = new Map<string, ActivityGroup>();
	readonly entries = new Map<string, ActivityGroup>();
	readonly calls = new Map<
		string,
		{ group: ActivityGroup; call: ActivityCall }
	>();
	current: ActivityGroup | undefined;
	private readonly messageIdentity = new ActivityMessageIdentity();
	private beforeAssistant: Set<string> | undefined;
	private retiredAnchors: string[] = [];

	assistantStarted(): void {
		// Native assistant rows precede their streamed text and any tool rows.
		this.beforeAssistant = new Set(this.current?.members.keys());
	}

	assistantUpdated(content: readonly { type: string; text?: string }[]): void {
		if (
			!this.beforeAssistant ||
			!content.some((block) => block.type === "text" && block.text?.trim())
		)
			return;
		const group = this.current;
		const previous = group?.anchorId;
		// Retire only rows above this reply. Tools already streamed below it stay eligible.
		const anchors = [...this.beforeAssistant].filter(
			(id) => group?.members.get(id)?.anchorEligible,
		);
		if (anchors.length) this.retiredAnchors = anchors;
		for (const id of this.beforeAssistant) {
			const member = group?.members.get(id);
			if (member) member.anchorEligible = false;
		}
		this.beforeAssistant = undefined;
		group?.refreshAnchor(previous);
	}

	/** Anchor after the latest native user row, even for steering inside one run. */
	userStarted(): void {
		const group = this.current;
		const previous = group?.anchorId;
		if (!group || previous === undefined) return;
		const anchors: string[] = [];
		for (const [id, member] of group.members) {
			if (!member.anchorEligible) continue;
			anchors.push(id);
			member.anchorEligible = false;
		}
		// A queued prompt can be followed only by an answer. Keep the previous
		// native position for settlement, just as for streamed commentary.
		if (anchors.length) this.retiredAnchors = anchors;
		group.refreshAnchor(previous);
	}

	refresh(): void {
		const groups = new Set([
			...this.messages.values(),
			...this.entries.values(),
			...[...this.calls.values()].map((member) => member.group),
		]);
		for (const group of groups) group.refresh();
	}

	private addNotice(
		id: string,
		now: number,
		estimated: boolean,
	): ActivityGroup {
		// Idle and preparation notices are already visible at their own positions.
		// Never borrow them as work belonging to a later prompt.
		const group = this.current ?? new ActivityGroup(now, estimated);
		group.members.set(id, { anchorEligible: true });
		if (group !== this.current) group.finish(now, "completed");
		return group;
	}

	addEntry(entry: CustomEntry, estimated = false): ActivityGroup {
		const id = `entry:${entry.id}`;
		const existing = this.entries.get(id);
		if (existing) return existing;
		const group = this.addNotice(id, Date.parse(entry.timestamp), estimated);
		this.entries.set(id, group);
		return group;
	}

	messageId(message: ActivityMessage, live = false) {
		return this.messageIdentity.messageId(message, live);
	}
	reconcileMessages(entries: readonly SessionEntry[]) {
		this.messageIdentity.reconcileMessages(entries);
	}

	start(now = Date.now()): ActivityGroup {
		this.current ??= new ActivityGroup(now);
		this.current.endedAt = undefined;
		this.current.outcome = "completed";
		return this.current;
	}

	add(id: string, name: string, now = Date.now()) {
		const existing = this.calls.get(id);
		if (existing) return existing;
		const group = this.start(now);
		const entry = { group, call: group.add(id, name) };
		this.calls.set(id, entry);
		return entry;
	}

	addMessage(
		message: ActivityMessage,
		live = false,
		entryId?: string,
	): ActivityGroup {
		const id = this.messageIdentity.messageId(message, live);
		const source = this.messageIdentity.source(id);
		if (source && entryId) source.entryId = entryId;
		const existing = this.messages.get(id);
		if (existing) return existing;
		const group = this.addNotice(id, message.timestamp, entryId !== undefined);
		this.messages.set(id, group);
		return group;
	}

	finish(
		now = Date.now(),
		outcome: ActivityGroup["outcome"] = "completed",
	): void {
		// A final reply has no successor activity row. Keep the disclosure at its
		// last truthful native position, never fabricate a row below the answer.
		if (this.current && !this.current.anchorId) {
			for (const id of this.retiredAnchors) {
				const member = this.current.members.get(id);
				if (member) member.anchorEligible = true;
			}
		}
		this.current?.finish(now, outcome);
		this.current = undefined;
		this.beforeAssistant = undefined;
		this.retiredAnchors = [];
	}

	retain(ids: ReadonlySet<string>, entries: readonly SessionEntry[]): void {
		this.renderGeneration++;
		this.reconcileMessages(entries);
		const messageIds = new Set(
			entries
				.filter((entry) => entry.type === "custom_message")
				.map((entry) => entry.id),
		);
		const entryIds = new Set(
			entries
				.filter((entry) => entry.type === "custom")
				.map((entry) => `entry:${entry.id}`),
		);
		const changed = new Set<ActivityGroup>();
		for (const [id, member] of this.calls) {
			if (ids.has(id)) continue;
			this.calls.delete(id);
			member.group.members.delete(id);
			member.group.calls.splice(member.group.calls.indexOf(member.call), 1);
			changed.add(member.group);
		}
		for (const [id, group] of this.messages) {
			const entryId = this.messageIdentity.source(id)?.entryId;
			if (entryId && messageIds.has(entryId)) continue;
			this.messages.delete(id);
			this.messageIdentity.remove(id);
			group.members.delete(id);
			group.notices.delete(id);
			group.noticeWarnings.delete(id);
			changed.add(group);
		}
		for (const [id, group] of this.entries) {
			if (entryIds.has(id)) continue;
			this.entries.delete(id);
			group.members.delete(id);
			group.notices.delete(id);
			group.noticeWarnings.delete(id);
			changed.add(group);
		}
		this.messageIdentity.prepareReplay(entries);
		for (const group of changed) group.refresh();
	}

	/** Rebuild only the active branch, never abandoned siblings. Durations are estimates. */
	restore(entries: readonly SessionEntry[]): void {
		this.renderGeneration++;
		this.calls.clear();
		this.messages.clear();
		this.entries.clear();
		this.messageIdentity.reset();
		this.current = undefined;
		this.beforeAssistant = undefined;
		this.retiredAnchors = [];
		replayActivity(this, entries);
		this.messageIdentity.prepareReplay(entries);
	}
}
