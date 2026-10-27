import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimePackage } from "../code-mode/runtime-package.ts";
import type { CodemodeWasmModule } from "@earendil-works/pi-codemode";

export interface JsRuntime { wasm: CodemodeWasmModule; moduleUrl: string }

export async function loadJsRuntime(agentDir: string, signal?: AbortSignal): Promise<JsRuntime> {
	const installed = await runtimePackage("@earendil-works/pi-codemode", "1.4.0", agentDir, "JS Notebook", signal);
	// This pinned package exposes its main only to ESM. Follow its published
	// entrypoint, not require.resolve's unsupported "require" export condition.
	const manifest: unknown = JSON.parse(await readFile(installed.manifest, "utf8"));
	if (!manifest || typeof manifest !== "object" || !("main" in manifest) || typeof manifest.main !== "string") throw new Error("The JS Notebook runtime package is incomplete; reinstall it, then retry");
	const runtime: typeof import("@earendil-works/pi-codemode") = await import(pathToFileURL(resolve(dirname(installed.manifest), manifest.main)).href);
	const engine = await runtimePackage("quickjs-wasi", "3.6.3", agentDir, "JS Notebook", signal);
	return { wasm: await runtime.loadQuickJSWasm(engine.resolve("quickjs-wasi/quickjs.wasm")), moduleUrl: pathToFileURL(engine.resolve("quickjs-wasi")).href };
}
