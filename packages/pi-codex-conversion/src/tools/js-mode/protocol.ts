import type { RuntimeContentItem } from "../code-mode/types.ts";
import type { CodemodeWasmModule } from "@earendil-works/pi-codemode";

export interface JsDeclaration { name: string; kind: "let" | "const" | "var" | "using" | "await using" | "function" | "class" }
export interface JsInventory { declarations: JsDeclaration[]; baseline: string[]; complete: boolean }
export interface JsBindingStatus { name: string; kind: JsDeclaration["kind"] | "global"; type: string }
export interface JsSnapshot { bytes: Uint8Array; controller: number; inventory?: JsInventory }
export interface JsTool { name: string; exposed: string; description?: string; output?: "plain-command" | "command" }
export interface JsInput { source?: string; tools: JsTool[]; inspect?: string }
export type JsCommand =
	| { kind: "run"; run: number; input: JsInput }
	| { kind: "reply"; run: number; id: number; json?: string; error?: string };
export interface JsOutcome { snapshot?: JsSnapshot; error?: string; fatal?: boolean; heapBytes: number; bindings?: JsBindingStatus[]; inventoryComplete?: boolean }
export type JsMessage = { run: number } & (
	| { kind: "output"; items: RuntimeContentItem[] }
	| { kind: "notify"; text: string }
	| { kind: "yield" }
	| { kind: "call"; id: number; name: string; json: string }
	| { kind: "done"; outcome: JsOutcome }
);
export interface JsWorkerData { wasm: CodemodeWasmModule; interrupt: SharedArrayBuffer; heapBytes: number; snapshot?: JsSnapshot }
