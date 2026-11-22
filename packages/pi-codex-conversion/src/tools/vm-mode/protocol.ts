import type { RuntimeContentItem } from "../code-mode/types.ts";

export interface VmTool {
	name: string;
	exposed: string;
	description?: string;
	output?: "plain-command" | "command";
}

export interface VmInput {
	source: string;
	tools: VmTool[];
	store: Record<string, string>;
}

export interface VmMemory {
	heapUsed: number;
	rss: number;
}

export type VmCommand =
	| { kind: "run"; run: number; input: VmInput }
	| { kind: "reply"; run: number; id: number; json?: string; error?: string }
	| { kind: "sample" };

export interface VmOutcome {
	error?: string;
	memory: VmMemory;
}

export type VmMessage =
	| { run: number; kind: "output"; items: RuntimeContentItem[] }
	| { run: number; kind: "notify"; text: string }
	| { run: number; kind: "yield" }
	| { run: number; kind: "store"; key: string; json?: string }
	| { run: number; kind: "call"; id: number; name: string; json: string }
	| { run: number; kind: "cancel" }
	| { run: number; kind: "done"; outcome: VmOutcome }
	| { kind: "sample"; memory: VmMemory };

export type VmProcessMessage = VmMessage | { kind: "ready" };
