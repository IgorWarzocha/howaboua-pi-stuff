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

export type VmCommand =
	| { kind: "run"; run: number; input: VmInput }
	| { kind: "reply"; run: number; id: number; json?: string; error?: string }
	| { kind: "bindings"; id: number }
	| { kind: "heapSample" };

export interface VmOutcome {
	error?: string;
}

export type VmMessage =
	| { run: number; kind: "output"; items: RuntimeContentItem[] }
	| { run: number; kind: "notify"; text: string }
	| { run: number; kind: "store"; key: string; json?: string }
	| { run: number; kind: "call"; id: number; name: string; json: string }
	| { run: number; kind: "cancel" }
	| { run: number; kind: "done"; outcome: VmOutcome }
	| { kind: "bindings"; id: number; names: string[]; memoryUsedBytes?: number }
	| { kind: "heapSample"; heapUsedBytes: number };

export type VmProcessMessage = VmMessage | { kind: "ready" };
