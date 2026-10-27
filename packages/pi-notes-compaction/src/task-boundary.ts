import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function renderTaskBoundaryReminder(
	remainingPercent: number,
	gpt = false,
): string {
	if (gpt)
		return `<context_window_reminder>\nSuggested budget reached; ${remainingPercent}% left. Task sequence→finish current task→save notes→new_context before next; otherwise continue here.\n</context_window_reminder>`;
	return `<context_window_reminder>\nSuggested context budget reached; ${remainingPercent}% remains. For a sequence of tasks, finish the current task, save notes and call new_context before the next. Otherwise, continue here.\n</context_window_reminder>`;
}

export const TASK_BOUNDARY_PRESETS = [
	0, 250_000, 300_000, 400_000, 450_000,
] as const;
export function taskBoundaryLabel(tokens: number): string {
	return tokens === 0
		? "off"
		: TASK_BOUNDARY_PRESETS.some((value) => value === tokens)
			? `${tokens / 1000}k`
			: "custom (edit JSON)";
}
export function taskBoundaryEligible(
	ctx: ExtensionContext,
	threshold: number,
	tokens = ctx.getContextUsage()?.tokens,
): boolean {
	const capacity =
		ctx.getContextUsage()?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	return (
		threshold > 0 &&
		Number.isFinite(capacity) &&
		capacity > 272_000 &&
		typeof tokens === "number" &&
		Number.isFinite(tokens) &&
		tokens >= threshold
	);
}
