import type { RuntimeContentItem } from "../code-mode/types.ts";
import type { CodemodeWasmModule } from "@earendil-works/pi-codemode";

export interface JsTool { name: string; exposed: string; description?: string; output?: "plain-command" | "command" }
export interface JsInput { source: string; tools: JsTool[]; store: Record<string, string> }
export type JsCommand =
	| { kind: "run"; run: number; input: JsInput }
	| { kind: "reply"; run: number; id: number; json?: string; error?: string };
export interface JsOutcome { error?: string }
export type JsMessage = { run: number } & (
	| { kind: "output"; items: RuntimeContentItem[] }
	| { kind: "notify"; text: string }
	| { kind: "yield" }
	| { kind: "store"; key: string; json?: string }
	| { kind: "call"; id: number; name: string; json: string }
	| { kind: "done"; outcome: JsOutcome }
);
export interface JsWorkerData { wasm: CodemodeWasmModule; moduleUrl: string; interrupt: SharedArrayBuffer; heapBytes: number }
