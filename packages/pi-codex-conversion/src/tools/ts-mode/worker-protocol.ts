import type { RuntimeContentItem } from "../code-mode/types.ts";
import type { BindingRecipe, PortableState } from "./portable-state.ts";

export interface TsWorkerInput {
	mode?: "live" | "isolated";
	/** Empty source captures the current heap without replaying or replacing it. */
	captureOnly?: boolean;
	/** Restore only these noncolliding durable additions into an existing kernel. */
	restore?: PortableState;
	state: PortableState;
	javascript: string;
	bindings: Record<string, BindingRecipe>;
	toolNames: Record<string, string>;
	toolMetadata: unknown[];
	outputHints: Record<string, "command" | "plain-command">;
	commandFormatter: string;
	maxStateBytes: number;
}
export type TsWorkerCommand = { kind: "start"; runId: number; input: TsWorkerInput } | TsWorkerReply;
export type TsWorkerMessage =
	| { kind: "output"; items: RuntimeContentItem[] }
	| { kind: "notify"; text: string }
	| { kind: "yield" }
	| { kind: "request"; id: number; operation: "tool" | "import"; name: string; input: unknown }
	| { kind: "done"; state: PortableState }
	| { kind: "live-done"; state: PortableState; skipped: { name: string; reason: string }[]; sourceStarted: boolean; error?: string; captureError?: string; restoreFailed?: string[] }
	| { kind: "error"; error: string };
export type TsWorkerEnvelope = { runId: number; message: TsWorkerMessage };
export type TsWorkerOutcome = Extract<TsWorkerMessage, {kind: "done" | "live-done"}>;
export interface TsWorkerReply { id: number; value?: unknown; error?: string }

export const TS_GLOBAL_DECLARATIONS = `
declare const ALL_TOOLS: ReadonlyArray<{name:keyof typeof tools;description:string}>;
declare function text(value: unknown): void;
declare function image(value: unknown, detail?: "auto" | "low" | "high" | "original" | null): void;
declare function generatedImage(value: unknown): void;
declare function notify(value: unknown): void;
declare function yield_control(): void;
declare function exit(): never;
declare function store(key: string, value: unknown): void;
declare function load<T = unknown>(key: string): T | undefined;
`;
