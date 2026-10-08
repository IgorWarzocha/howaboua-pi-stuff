import type {
	CustomEntry,
	MessageRenderer,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { CurrentStage } from "./current-stage.js";

type CustomMessage = Parameters<MessageRenderer>[0];
type ActivityMessage = Pick<
	CustomMessage,
	"customType" | "content" | "timestamp" | "details"
>;

// Opt-in display policy, not a protocol registry. Add a type only when its full
// body remains recoverable; unknown notices should keep their native presentation.
export const activityMessageTypes = [
	"herdr-agent-message",
	"herdr-agent-event",
	"shepherdr-board-post",
	"subdir-agents-context",
	"codex-developer-message",
	"codex-context-window",
	"codex-native-compaction-display",
] as const;

export const activityEntryTypes = [
	"shepherdr-board-post-marker",
	"codex-notebook-status",
	"codex-toolkit-update",
	"codex-native-compaction-display",
] as const;

function messageKey(message: ActivityMessage): string {
	return JSON.stringify([message.customType, message.content, message.details]);
}

function replayKey(message: ActivityMessage): string {
	return JSON.stringify([message.timestamp, messageKey(message)]);
}

/** Code/Notebook Mode can report script and nested errors in successful outer results. */
export function hasCodeModeError(details: unknown): boolean {
	if (
		!details ||
		typeof details !== "object" ||
		!("codeMode" in details) ||
		details.codeMode !== true
	)
		return false;
	if (
		"scriptError" in details &&
		typeof details.scriptError === "string" &&
		details.scriptError.length > 0
	)
		return true;
	return (
		"traces" in details &&
		Array.isArray(details.traces) &&
		details.traces.some(
			(trace: unknown) =>
				trace !== null &&
				typeof trace === "object" &&
				"status" in trace &&
				trace.status === "error",
		)
	);
}

export interface ActivityCall {
	id: string;
	name: string;
	status: "pending" | "running" | "done" | "error" | "interrupted";
}

export class ActivityGroup {
	readonly calls: ActivityCall[] = [];
	readonly members = new Map<
		string,
		{ invalidate?: () => void; anchorEligible: boolean }
	>();
	readonly notices = new Map<string, string>();
	readonly boardActivity = new Map<string, string>();
	readonly noticeWarnings = new Set<string>();
	open = false;
	nativeExpanded = false;
	attention = false;
	readonly stage = new CurrentStage();
	endedAt: number | undefined;
	outcome: "completed" | "interrupted" = "completed";
	startedAt: number;
	readonly estimated: boolean;

	constructor(startedAt: number, estimated = false) {
		this.startedAt = startedAt;
		this.estimated = estimated;
	}

	add(id: string, name: string): ActivityCall {
		const existing = this.calls.find((call) => call.id === id);
		if (existing) return existing;
		const call: ActivityCall = { id, name, status: "pending" };
		this.calls.push(call);
		this.members.set(id, { anchorEligible: true });
		return call;
	}

	get anchorId(): string | undefined {
		return [...this.members].find(([, member]) => member.anchorEligible)?.[0];
	}

	refresh(exceptId?: string): void {
		for (const [id, member] of this.members)
			if (id !== exceptId) member.invalidate?.();
	}

	nativeExpansion(expanded: boolean, memberId: string): void {
		// Arrivals inherit the native preference, not ownership of a mouse-made choice.
		if (this.nativeExpanded === expanded) return;
		this.nativeExpanded = expanded;
		this.open = expanded;
		this.refresh(memberId);
	}

	get warning(): boolean {
		return (
			this.attention ||
			this.noticeWarnings.size > 0 ||
			this.outcome === "interrupted"
		);
	}

	finish(now: number, outcome: ActivityGroup["outcome"]): void {
		this.endedAt = now;
		this.outcome = outcome;
		this.attention = false;
		this.stage.finish();
		for (const call of this.calls) {
			if (call.status === "pending" || call.status === "running") {
				call.status = "interrupted";
			}
		}
		this.refresh();
	}

	label(now = Date.now()): string {
		const seconds = Math.max(
			0,
			Math.floor(((this.endedAt ?? now) - this.startedAt) / 1000),
		);
		const duration =
			seconds < 60
				? `${seconds}s`
				: `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
		const heading =
			this.endedAt === undefined
				? "Working"
				: this.outcome === "completed"
					? "Worked"
					: "Stopped";
		const flags = [
			this.attention ? "needs attention" : "",
			...[...new Set(this.boardActivity.values())].map((direction) => {
				const count = [...this.boardActivity.values()].filter(
					(value) => value === direction,
				).length;
				return count
					? direction === "posted"
						? `${count} board ${count === 1 ? "post" : "posts"} sent`
						: direction === "received"
							? `${count} board ${count === 1 ? "notice" : "notices"} received`
							: `${direction}${count > 1 ? ` ×${count}` : ""}`
					: "";
			}),
			...new Set(this.notices.values()),
		].filter(Boolean);
		return `${heading} · ${this.estimated ? "~" : ""}${duration}${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
	}
}

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
	private messageObjects = new WeakMap<object, string>();
	private readonly messageSources = new Map<
		string,
		{ key: string; entryId?: string }
	>();
	private readonly replayMessages = new Map<string, string[]>();
	private nextMessageId = 0;
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
		if (entry.customType === "shepherdr-board-post-marker") {
			const data = entry.data;
			group.boardActivity.set(
				id,
				data &&
					typeof data === "object" &&
					"label" in data &&
					typeof data.label === "string"
					? data.label
					: "posted",
			);
		}
		this.entries.set(id, group);
		if (group !== this.current) {
			group.finish(time, "completed");
			this.pendingMessageGroup = group;
		}
		return group;
	}

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
		for (const entry of entries) {
			if (
				entry.type !== "custom_message" ||
				!entry.display ||
				!activityMessageTypes.some((type) => type === entry.customType)
			)
				continue;
			const sources = [...this.messageSources.values()];
			if (sources.some((source) => source.entryId === entry.id)) continue;
			const key = messageKey({
				...entry,
				timestamp: Date.parse(entry.timestamp),
			});
			const source = sources.find(
				(source) => source.entryId === undefined && source.key === key,
			);
			if (source) source.entryId = entry.id;
		}
	}

	private prepareMessageReplay(entries: readonly SessionEntry[]): void {
		this.replayMessages.clear();
		for (const entry of entries) {
			if (entry.type !== "custom_message") continue;
			const id = [...this.messageSources].find(
				([, source]) => source.entryId === entry.id,
			)?.[0];
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
		const id = this.messageId(message, live);
		const source = this.messageSources.get(id);
		if (source && entryId) source.entryId = entryId;
		const existing = this.messages.get(id);
		if (existing) return existing;
		const group =
			this.current ??
			this.pendingMessageGroup ??
			new ActivityGroup(message.timestamp);
		group.members.set(id, { anchorEligible: this.afterUser });
		if (message.customType === "shepherdr-board-post")
			group.boardActivity.set(id, "received");
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
			const entryId = this.messageSources.get(id)?.entryId;
			if (entryId && messageIds.has(entryId)) continue;
			this.messages.delete(id);
			this.messageSources.delete(id);
			group.members.delete(id);
			group.notices.delete(id);
			group.boardActivity.delete(id);
			group.noticeWarnings.delete(id);
			changed.add(group);
		}
		for (const [id, group] of this.entries) {
			if (entryIds.has(id)) continue;
			this.entries.delete(id);
			group.members.delete(id);
			group.notices.delete(id);
			group.boardActivity.delete(id);
			group.noticeWarnings.delete(id);
			changed.add(group);
		}
		this.prepareMessageReplay(entries);
		for (const group of changed) group.refresh();
	}

	/** Rebuild only the active branch, never abandoned siblings. Durations are estimates. */
	restore(entries: readonly SessionEntry[]): void {
		this.renderGeneration++;
		this.calls.clear();
		this.messages.clear();
		this.entries.clear();
		this.messageObjects = new WeakMap();
		this.messageSources.clear();
		this.replayMessages.clear();
		this.current = undefined;
		this.pendingMessageGroup = undefined;
		this.afterUser = false;
		this.beforeAssistant = undefined;
		this.retiredAnchors = [];
		let startedAt: number | undefined;
		let endedAt = 0;
		for (const entry of entries) {
			const time = Date.parse(entry.timestamp);
			if (Number.isFinite(time)) endedAt = time;
			if (
				entry.type === "custom" &&
				activityEntryTypes.some((type) => type === entry.customType)
			) {
				this.current ??= new ActivityGroup(startedAt ?? endedAt, true);
				this.addEntry(entry);
				continue;
			}
			if (
				entry.type === "custom_message" &&
				entry.display &&
				activityMessageTypes.some((type) => type === entry.customType)
			) {
				this.current ??= new ActivityGroup(startedAt ?? endedAt, true);
				this.addMessage({ ...entry, timestamp: endedAt }, true, entry.id);
				continue;
			}
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message.role === "user") {
				this.userStarted();
				startedAt = endedAt;
			} else if (message.role === "assistant") {
				this.assistantStarted();
				this.assistantUpdated(message.content);
				const tools = message.content.filter(
					(block) => block.type === "toolCall",
				);
				if (tools.length) {
					this.current ??= new ActivityGroup(startedAt ?? endedAt, true);
					for (const tool of tools) {
						if (tool.name === "new_context") continue;
						this.add(tool.id, tool.name);
						this.current.stage.start(tool.id, tool.name, tool.arguments);
					}
				}
				const interrupted =
					message.stopReason === "aborted" ||
					message.stopReason === "error" ||
					message.stopReason === "length";
				if (
					interrupted ||
					(tools.length === 0 && message.stopReason !== "toolUse")
				) {
					this.finish(
						endedAt,
						message.stopReason === "stop" ? "completed" : "interrupted",
					);
					startedAt = undefined;
				}
			} else if (message.role === "toolResult") {
				const member = this.calls.get(message.toolCallId);
				if (member) {
					member.call.status =
						message.isError || hasCodeModeError(message.details)
							? "error"
							: "done";
					member.group.stage.end(
						message.toolCallId,
						message,
						member.call.status === "error",
					);
				}
			}
		}
		this.finish(
			endedAt,
			this.current?.calls.length ? "interrupted" : "completed",
		);
		this.prepareMessageReplay(entries);
	}
}
