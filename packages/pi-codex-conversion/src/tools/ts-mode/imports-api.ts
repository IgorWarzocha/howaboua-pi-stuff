import type { API } from "tsrs/unstable/async";
import type { TsImportOptions } from "./imports.ts";
import { loadTsRuntime, type TsRuntime } from "./runtime.ts";

export async function withTsImportApi<T>(options: TsImportOptions, operation: (api: API, runtime: TsRuntime) => Promise<T>): Promise<T> {
	if (options.compiler) return options.compiler.withApi(operation);
	const runtime = await loadTsRuntime(options.agentDir, options.signal);
	const api = new runtime.api.API({ cwd: options.cwd });
	try { return await operation(api, runtime); }
	finally { await api.close(); }
}
