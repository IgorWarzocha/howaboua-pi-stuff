import type { Message, ModelThinkingLevel } from "@earendil-works/pi-ai";

export type ThinkingLevel = ModelThinkingLevel;
export type ExploreMode = "shallow" | "deep";

export interface ExploreConfig {
	model: string;
	thinking?: ThinkingLevel;
}

export interface ExtensionConfig {
	shallow?: ExploreConfig;
	deep?: ExploreConfig;
}

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
	mode: ExploreMode;
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

export interface PersistedChildRunDetails {
	mode: ExploreMode;
	cwd: string;
}

export interface ModeSpec {
	label: string;
	shortDescription: string;
	promptPath: string;
	systemPreamble: string;
}

export interface SubagentMessageDetails {
	status: "running" | "done" | "failed";
	details?: ChildRunDetails;
	error?: string;
}
