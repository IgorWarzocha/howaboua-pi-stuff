import type { ThinkingLevel as PiThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BtwChild } from "./rpc-child.js";

export type ThinkingLevel = PiThinkingLevel;

export interface BtwConfig {
	provider: string;
	modelId: string;
	command?: string;
	thinking?: ThinkingLevel;
	injectShortcut?: string;
	dismissShortcut?: string;
	composeShortcut?: string;
	foldShortcut?: string;
	unfoldShortcut?: string;
	previousShortcut?: string;
	nextShortcut?: string;
	/** @deprecated legacy combined ref; migrated on read */
	model?: string;
}

export interface BtwTurn {
	question: string;
	answer?: string;
	error?: string;
	partial?: string;
	startedAt: number;
	finishedAt?: number;
	status?: "queued" | "running" | "answered" | "failed";
	turnIndex?: number;
}

export interface BtwSession {
	index: number;
	generationId: string;
	nextTurnIndex: number;
	child?: BtwChild | undefined;
	turns: BtwTurn[];
	running: boolean;
	unread: boolean;
	generation: number;
	queue: Promise<void>;
	restored?: boolean;
}

export interface BtwState {
	sessions: (BtwSession | undefined)[];
	activeIndex: number;
	folded: boolean;
	ctx?: ExtensionContext | undefined;
}

export interface ChildDetails {
	cwd: string;
	provider: string;
	modelId: string;
	thinking?: ThinkingLevel;
	messages: Message[];
	stderr: string;
	usage: {
		turns: number;
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens: number;
	};
	stopReason?: string;
	errorMessage?: string;
}

export type ResolvedBtwConfig = Required<Omit<BtwConfig, "model">>;
