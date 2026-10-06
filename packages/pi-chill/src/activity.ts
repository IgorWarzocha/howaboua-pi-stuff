import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { CurrentStage } from "./current-stage.js";

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
	invalidate?: () => void;
}

export class ActivityGroup {
	readonly calls: ActivityCall[] = [];
	open = false;
	nativeExpanded = false;
	attention = false;
	readonly stage = new CurrentStage();
	endedAt: number | undefined;
	outcome: "completed" | "interrupted" = "completed";
	readonly startedAt: number;
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
		return call;
	}

	refresh(): void {
		for (const call of this.calls) call.invalidate?.();
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
		return `${heading} · ${this.estimated ? "~" : ""}${duration}${this.attention ? " · needs attention" : ""}`;
	}
}

export class ActivityTimeline {
	readonly calls = new Map<
		string,
		{ group: ActivityGroup; call: ActivityCall }
	>();
	current: ActivityGroup | undefined;

	start(now = Date.now()): ActivityGroup {
		this.current ??= new ActivityGroup(now);
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

	finish(
		now = Date.now(),
		outcome: ActivityGroup["outcome"] = "completed",
	): void {
		this.current?.finish(now, outcome);
		this.current = undefined;
	}

	retain(ids: ReadonlySet<string>): void {
		const changed = new Set<ActivityGroup>();
		for (const [id, member] of this.calls) {
			if (ids.has(id)) continue;
			this.calls.delete(id);
			member.group.calls.splice(member.group.calls.indexOf(member.call), 1);
			changed.add(member.group);
		}
		for (const group of changed) group.refresh();
	}

	/** Rebuild only the active branch, never abandoned siblings. Durations are estimates. */
	restore(entries: readonly SessionEntry[]): void {
		this.calls.clear();
		this.current = undefined;
		let startedAt: number | undefined;
		let endedAt = 0;
		for (const entry of entries) {
			const time = Date.parse(entry.timestamp);
			if (Number.isFinite(time)) endedAt = time;
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message.role === "user") {
				this.finish(endedAt, "interrupted");
				startedAt = endedAt;
			} else if (message.role === "assistant") {
				const tools = message.content.filter(
					(block) => block.type === "toolCall",
				);
				if (tools.length) {
					this.current ??= new ActivityGroup(startedAt ?? endedAt, true);
					for (const tool of tools) {
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
		this.finish(endedAt, "interrupted");
	}
}
