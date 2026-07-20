import type { Message, ModelThinkingLevel } from "@earendil-works/pi-ai";

export type BaseKind = "integration" | "trunk";

export interface BaseCandidate {
	ref: string;
	label: string;
	kind: BaseKind;
	mergeBase: string;
	distance: number;
}

export interface ChangedFileFact {
	path: string;
	additions: number;
	deletions: number;
	lines: number;
	hunks: number;
	moduleStatements: number;
	deleted: boolean;
	untracked: boolean;
}

export interface HardeningContext {
	repoRoot: string;
	currentBranch: string;
	base: BaseCandidate;
	status: string;
	fingerprint: string;
	changedFiles: string[];
	candidates: ChangedFileFact[];
}

export type WorkerDisposition =
	| { status: "blocked"; reason: string }
	| { status: "complete" }
	| { status: "incomplete" };

export interface WorkerRunDetails {
	messages: Message[];
	stderr: string;
	exitCode: number;
	model: string;
	thinking: ModelThinkingLevel;
	stopReason?: string;
	errorMessage?: string;
}
