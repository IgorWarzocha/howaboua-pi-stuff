import { CurrentStage } from "./current-stage.js";

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
		for (const [id, member] of this.members)
			if (member.anchorEligible) return id;
		return undefined;
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
			...new Set(this.notices.values()),
		].filter(Boolean);
		return `${heading} · ${this.estimated ? "~" : ""}${duration}${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
	}
}
