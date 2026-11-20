import { readFile } from "node:fs/promises";
import { createRequire, findPackageJSON } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CodemodeWasmModule } from "@earendil-works/pi-codemode";

export interface JsRuntime {
	wasm: CodemodeWasmModule;
	moduleUrl: string;
}

export async function loadJsRuntime(
	piPackageDir: string,
	signal?: AbortSignal,
): Promise<JsRuntime> {
	signal?.throwIfAborted();
	try {
		// Resolve from Pi, not the independently installed extension.
		const piBase = pathToFileURL(join(piPackageDir, "package.json"));
		const piRequire = createRequire(piBase);
		const moduleUrl = pathToFileURL(piRequire.resolve("quickjs-wasi")).href;
		const wasmPath = piRequire.resolve("quickjs-wasi/quickjs.wasm");

		// pi-codemode's entry is ESM-only, so require.resolve cannot find it.
		const manifestPath = findPackageJSON("@earendil-works/pi-codemode", piBase);
		if (!manifestPath) throw new Error("Missing Pi codemode package");
		const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
		if (
			!manifest ||
			typeof manifest !== "object" ||
			!("main" in manifest) ||
			typeof manifest.main !== "string"
		)
			throw new Error("Missing Pi codemode entry point");
		signal?.throwIfAborted();
		const runtime: typeof import("@earendil-works/pi-codemode") = await import(
			pathToFileURL(resolve(dirname(manifestPath), manifest.main)).href
		);
		const wasm = await runtime.loadQuickJSWasm(wasmPath);
		signal?.throwIfAborted();
		return { wasm, moduleUrl };
	} catch (cause) {
		signal?.throwIfAborted();
		throw new Error(
			"QuickJS Code could not load Pi's QuickJS runtime. Use an npm installation of Pi under Node.js, or switch to Code",
			{ cause },
		);
	}
}
