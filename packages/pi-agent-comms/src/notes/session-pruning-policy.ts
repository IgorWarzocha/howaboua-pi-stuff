export const HISTORY_WINDOWS = [0, 5, 10, 25] as const;
export const CONVERSATION_DAYS = [0, 7, 30] as const;
export interface SessionPruningPolicy {
	windows: (typeof HISTORY_WINDOWS)[number];
	days: (typeof CONVERSATION_DAYS)[number];
}
export const PRUNING_OFF: SessionPruningPolicy = { windows: 0, days: 0 };
export const RESTART_NOTICE =
	"Memory savings take effect after restarting Pi. /reload is not sufficient.";
export function pruningPolicy(value: unknown): SessionPruningPolicy {
	if (!value || typeof value !== "object")
		throw new Error("Invalid pruning policy");
	const policy = value as SessionPruningPolicy;
	if (
		!HISTORY_WINDOWS.includes(policy.windows) ||
		!CONVERSATION_DAYS.includes(policy.days)
	)
		throw new Error("Invalid pruning policy");
	return { windows: policy.windows, days: policy.days };
}
