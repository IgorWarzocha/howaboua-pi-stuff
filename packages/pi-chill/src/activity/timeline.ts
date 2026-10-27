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
	private pendingMessageGroup: ActivityGroup | undefined;
	private readonly messageIdentity = new ActivityMessageIdentity();
	private afterUser = false;
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
		// Retire only rows above this reply. Tools already streamed below it stay eligible.
		const anchors = [...this.beforeAssistant].filter(
			(id) => this.current?.members.get(id)?.anchorEligible,
		);
		if (anchors.length) this.retiredAnchors = anchors;
		for (const id of this.beforeAssistant) {
			const member = this.current?.members.get(id);
			if (member) member.anchorEligible = false;
		}
		this.beforeAssistant = undefined;
		this.current?.refresh();
	}

	/** Anchor after the latest native user row, even for steering inside one run. */
	userStarted(): void {
		// Queued steering can emit another user row inside the same live run.
		// Keep its duration/details, but only subsequent rows may anchor below it.
		if (this.current) {
			const anchors = [...this.current.members].filter(
				([, member]) => member.anchorEligible,
			);
			// A queued prompt can be followed only by an answer. Preserve the last
			// native position for settlement, just as for streamed commentary.
			if (anchors.length) this.retiredAnchors = anchors.map(([id]) => id);
			for (const member of this.current.members.values())
				member.anchorEligible = false;
			this.current.refresh();
		}
		this.afterUser = true;
	}

	refresh(): void {
		const groups = new Set([
			...this.messages.values(),
			...this.entries.values(),
			...[...this.calls.values()].map((member) => member.group),
		]);
		for (const group of groups) group.refresh();
	}

	addEntry(entry: CustomEntry): ActivityGroup {
		const id = `entry:${entry.id}`;
		const existing = this.entries.get(id);
		if (existing) return existing;
		const time = Date.parse(entry.timestamp);
		const group =
			this.current ?? this.pendingMessageGroup ?? new ActivityGroup(time);
		group.members.set(id, { anchorEligible: this.afterUser });
		this.entries.set(id, group);
		if (group !== this.current) {
			group.finish(time, "completed");
			this.pendingMessageGroup = group;
		}
		return group;
	}

	messageId(message: ActivityMessage, live = false) {
		return this.messageIdentity.messageId(message, live);
	}
	reconcileMessages(entries: readonly SessionEntry[]) {
		this.messageIdentity.reconcileMessages(entries);
	}

	start(now = Date.now()): ActivityGroup {
		this.current ??= this.pendingMessageGroup ?? new ActivityGroup(now);
		this.pendingMessageGroup = undefined;
		this.current.endedAt = undefined;
		this.current.outcome = "completed";
		return this.current;
	}

	beginRun(now = Date.now()): ActivityGroup {
		const continuing =
			this.current !== undefined && this.current.endedAt === undefined;
		const group = this.start(now);
		// Idle/preparation notices may be old. Elapsed work starts at agent_start.
		// Native continue() emits agent_start again before the SDK settles the run.
		if (!continuing) group.startedAt = now;
		return group;
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
		const group =
			this.current ??
			this.pendingMessageGroup ??
			new ActivityGroup(message.timestamp);
		group.members.set(id, { anchorEligible: this.afterUser });
		this.messages.set(id, group);
		if (group !== this.current) {
			group.finish(message.timestamp, "completed");
			this.pendingMessageGroup = group;
		}
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
		this.pendingMessageGroup = undefined;
		this.afterUser = false;
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
		this.pendingMessageGroup = undefined;
		this.afterUser = false;
		this.beforeAssistant = undefined;
		this.retiredAnchors = [];
		replayActivity(this, entries);
		this.messageIdentity.prepareReplay(entries);
	}
}
