import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimePackage } from "../code-mode/runtime-package.ts";

export interface TsRuntime {
	api: typeof import("tsrs/async");
	ast: typeof import("tsrs/ast");
	fs: typeof import("tsrs/fs");
	typeRoots: string[];
	launcher: string;
}

export async function loadTsRuntime(agentDir: string, signal?: AbortSignal): Promise<TsRuntime> {
	const compiler = await runtimePackage("tsrs", "0.20.0-ts7.1.0-beta", agentDir, "TS", signal);
	const node = await runtimePackage("@types/node", "26.6.5", agentDir, "TS", signal);
	const [api, ast, fs]: [TsRuntime["api"], TsRuntime["ast"], TsRuntime["fs"]] = await Promise.all([
		import(pathToFileURL(compiler.resolve("tsrs/async")).href),
		import(pathToFileURL(compiler.resolve("tsrs/ast")).href),
		import(pathToFileURL(compiler.resolve("tsrs/fs")).href),
	]);
	return { api, ast, fs, typeRoots: [dirname(dirname(node.resolve("@types/node/package.json")))], launcher: join(dirname(compiler.manifest), "bin", "tsrs") };
}
