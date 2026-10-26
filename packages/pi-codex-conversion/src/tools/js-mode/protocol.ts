import type { RuntimeContentItem } from "../code-mode/types.ts";
import type { CodemodeWasmModule } from "@earendil-works/pi-codemode";
import type { NotebookHook } from "../code-mode/types.ts";
import type { PortableState } from "../ts-mode/portable-state.ts";
import type { JsReleaseResult } from "./data-state.ts";

export interface JsDeclaration { name: string; kind: "let" | "const" | "var" | "using" | "await using" | "function" | "class" }
export interface JsInventory { declarations: JsDeclaration[]; baseline: string[]; complete: boolean }
export interface JsBindingStatus { name: string; kind: JsDeclaration["kind"] | "global"; type: string }
export interface JsSnapshot { bytes: Uint8Array; controller: number; inventory?: JsInventory; support?: number; bindings?: number; projectRevision?: string; pins?: string[]; observedProject?: { key: string; state: PortableState }; startup?: { status: "pending" | "done" | "failed"; error?: string } }
export interface JsTool { name: string; exposed: string; description?: string; output?: "plain-command" | "command" }
export type JsDataOperation = { action: "export" | "pin" | "unpin" | "release"; names: string[] } | { action: "import"; state: PortableState; pins?: string[] };
export interface JsInput { source?: string; tools: JsTool[]; inspect?: string; hook?: { name: string; event: NotebookHook | false }; data?: JsDataOperation; management?: boolean }
export type JsCommand =
	| { kind: "run"; run: number; input: JsInput }
	| { kind: "reply"; run: number; id: number; json?: string; error?: string };
export interface JsOutcome { snapshot?: JsSnapshot; error?: string; fatal?: boolean; heapBytes: number; bindings?: JsBindingStatus[]; inventoryComplete?: boolean; hooks?: { name: string; event: NotebookHook }[]; pins?: string[]; pinState?: PortableState; pinError?: string; data?: PortableState; release?: JsReleaseResult }
export type JsMessage = { run: number } & (
	| { kind: "output"; items: RuntimeContentItem[] }
	| { kind: "notify"; text: string }
	| { kind: "yield" }
	| { kind: "call"; id: number; name: string; json: string }
	| { kind: "done"; outcome: JsOutcome }
);
export interface JsWorkerData { wasm: CodemodeWasmModule; moduleUrl: string; interrupt: SharedArrayBuffer; heapBytes: number; snapshot?: JsSnapshot }
