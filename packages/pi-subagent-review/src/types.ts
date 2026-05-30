import type { Message } from "@earendil-works/pi-ai";

export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export interface SummaryConfig {
	enabled?: boolean;
	model?: string;
	thinking?: ThinkingLevel;
}

export interface ReviewConfig {
	model: string;
	thinking?: ThinkingLevel;
	summary?: SummaryConfig;
}

export interface ParsedModelRef {
	provider: string;
	modelId: string;
}

export interface ResolvedSummaryConfig {
	enabled: boolean;
	model: string;
	modelParsed: ParsedModelRef;
	thinking: ThinkingLevel;
	source: "configured" | "current";
}

export type ResolvedReviewConfig = Required<
	Pick<ReviewConfig, "model" | "thinking">
> & {
	source: "configured" | "current";
	summary: ResolvedSummaryConfig;
};

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface ChildRunDetails {
	mode: "review";
	toolName: string;
	task: string;
	cwd: string;
	model: string;
	thinking?: ThinkingLevel;
	messages: Message[];
	stderr: string;
	exitCode: number;
	stopReason?: string;
	errorMessage?: string;
	usage: UsageStats;
}

export interface ReviewContext {
	repoRoot: string;
	currentRef: string;
	scope: "base-diff" | "current-state" | "latest-commit";
	baseBranch?: "main" | "master" | "dev" | undefined;
	mergeBase?: string | undefined;
	baseTip?: string | undefined;
	latestCommit?: string | undefined;
	status: string;
	recentBaseCommits?: string | undefined;
	hasTrackedChanges: boolean;
	hasAnyChanges: boolean;
}
