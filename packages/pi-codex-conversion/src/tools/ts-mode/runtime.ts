import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimePackage } from "../code-mode/runtime-package.ts";

export interface TsRuntime {
	api: typeof import("tsrs/unstable/async");
	ast: typeof import("tsrs/unstable/ast");
	fs: typeof import("tsrs/unstable/fs");
	typeRoots: string[];
}

export async function loadTsRuntime(agentDir: string, signal?: AbortSignal): Promise<TsRuntime> {
	const compiler = await runtimePackage("tsrs", "0.18.0-ts7.1.0-dev.20260929", agentDir, "TS", signal);
	const node = await runtimePackage("@types/node", "26.6.5", agentDir, "TS", signal);
	const [api, ast, fs]: [TsRuntime["api"], TsRuntime["ast"], TsRuntime["fs"]] = await Promise.all([
		import(pathToFileURL(compiler.resolve("tsrs/unstable/async")).href),
		import(pathToFileURL(compiler.resolve("tsrs/unstable/ast")).href),
		import(pathToFileURL(compiler.resolve("tsrs/unstable/fs")).href),
	]);
	return { api, ast, fs, typeRoots: [dirname(dirname(node.resolve("@types/node/package.json")))] };
}
