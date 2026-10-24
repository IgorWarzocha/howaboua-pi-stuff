import { API } from "tsrs/unstable/async";
import type { TsImportOptions } from "./imports.ts";

export async function withTsImportApi<T>(options: TsImportOptions, operation: (api: API) => Promise<T>): Promise<T> {
	if (options.compiler) return options.compiler.withApi(operation);
	const api = new API({ cwd: options.cwd });
	try { return await operation(api); }
	finally { await api.close(); }
}
