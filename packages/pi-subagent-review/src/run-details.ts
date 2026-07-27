import { REVIEW_COMMAND } from "./constants.js";
import type {
	ChildRunDetails,
	ResolvedReviewConfig,
	UsageStats,
} from "./types.js";

function emptyUsage(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

export function createChildRunDetails(
	task: string,
	cwd: string,
	config: Omit<ResolvedReviewConfig, "source">,
): ChildRunDetails {
	return {
		mode: "review",
		toolName: REVIEW_COMMAND,
		task,
		cwd,
		model: config.model,
		thinking: config.thinking,
		messages: [],
		stderr: "",
		exitCode: 0,
		usage: emptyUsage(),
	};
}

export function isSubagentFailure(
	details: Pick<ChildRunDetails, "exitCode" | "stopReason">,
): boolean {
	return (
		details.exitCode !== 0 ||
		details.stopReason === "error" ||
		details.stopReason === "aborted"
	);
}
