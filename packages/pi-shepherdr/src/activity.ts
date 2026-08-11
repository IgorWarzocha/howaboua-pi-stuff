import type {
	AgentActivity,
	AgentStatus,
	PaneInfo,
	SettledAgentStatus,
	StableAgentActivity,
} from "./types.js";

const SETTLED_STATUSES: ReadonlySet<AgentStatus> = new Set([
	"idle",
	"done",
	"blocked",
]);
const AGENT_STATUSES: ReadonlySet<string> = new Set([
	"idle",
	"working",
	"blocked",
	"done",
	"unknown",
]);

export function activityStatus(activity: AgentActivity): AgentStatus {
	return activity.phase === "settled" ? activity.status : "working";
}

export function activityTask(activity: AgentActivity): string | undefined {
	return activity.phase === "settled" ? undefined : activity.task;
}

export function isSettledStatus(
	status: AgentStatus,
): status is SettledAgentStatus {
	return SETTLED_STATUSES.has(status);
}

export function isAgentStatus(value: unknown): value is AgentStatus {
	return typeof value === "string" && AGENT_STATUSES.has(value);
}

export function activityForPanel(panel: PaneInfo): StableAgentActivity {
	return panel.agent_status === "working"
		? { phase: "working" }
		: { phase: "settled", status: panel.agent_status };
}

export function sameAgentActivity(
	left: AgentActivity,
	right: AgentActivity,
): boolean {
	if (left.phase !== right.phase) return false;
	if (left.phase === "settled" && right.phase === "settled") {
		return left.status === right.status;
	}
	if (left.phase === "working" && right.phase === "working") {
		return left.task === right.task;
	}
	return (
		left.phase === "submitting" &&
		right.phase === "submitting" &&
		left.attemptId === right.attemptId &&
		left.task === right.task &&
		sameAgentActivity(left.previous, right.previous)
	);
}
