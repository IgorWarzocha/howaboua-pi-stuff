import type { API } from "tsrs/async";
import type { TsImportOptions } from "./imports.ts";
import { loadTsRuntime, type TsRuntime } from "./runtime.ts";
import { startTsCompiler } from "./compiler-process.ts";

export async function withTsImportApi<T>(options: TsImportOptions, operation: (api: API, runtime: TsRuntime) => Promise<T>): Promise<T> {
	if (options.compiler) return options.compiler.withApi(operation);
	const runtime = await loadTsRuntime(options.agentDir, options.signal);
	const compiler = await startTsCompiler(runtime, { cwd: options.cwd });
	try { return await operation(compiler.api, runtime); }
	finally { await compiler.close(); }
}
