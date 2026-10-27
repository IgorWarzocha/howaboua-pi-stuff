import { isBuiltin } from "node:module";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { API } from "tsrs/async";
import type { TsRuntime } from "./runtime.ts";
import type { TsCompiler } from "./compiler.ts";
import { resolveTsSource, withTsImportApi } from "./imports-api.ts";
import { cacheExactNpmImport, runImportCommand } from "../code-mode/npm-cache.ts";
import { compileTsImportSource } from "./imports-source.ts";

export interface TsImportOptions {
	cwd: string;
	agentDir: string;
	cacheDir: string;
	/** Caller-owned disposable directory, separate from the persistent npm cache. */
	sourceDir?: string;
	/** Caller-owned module identity shared by static/dynamic imports throughout a live kernel. */
	sourceModules?: Map<string, string>;
	compiler?: Pick<TsCompiler, "withApi">;
	signal?: AbortSignal;
	onNpmImport?: (specifier: string) => void;
}

export interface TsImportResolutions {
	moduleResolutions: Map<string, string>;
	runtimeSpecifiers: Map<string, string>;
}

async function importLocation(specifier: string, options: TsImportOptions): Promise<{ cwd: string; bare: string }> {
	options.signal?.throwIfAborted();
	if (specifier.startsWith("npm:")) {
		const location = await cacheExactNpmImport(specifier, options.cacheDir, options.signal);
		options.onNpmImport?.(specifier);
		return location;
	}
	if (/^[a-zA-Z][\w+.-]*:/.test(specifier) && !specifier.startsWith("node:") && !specifier.startsWith("file:")) {
		throw new Error(`Unsupported import ${specifier}. Use node:, an installed package, an exact npm: import, or a local file.`);
	}
	return { cwd: resolve(options.cwd), bare: specifier };
}

async function runtimeLocation(bare: string, cwd: string, signal?: AbortSignal, resolveSource?: () => Promise<string | undefined>, mode: "import" | "require" = "import"): Promise<string> {
	signal?.throwIfAborted();
	if (isBuiltin(bare)) return bare.startsWith("node:") ? bare : `node:${bare}`;
	const localSource = async (): Promise<string | undefined> => {
		if (!/^\.{1,2}\//.test(bare) || !/\.(?:js|mjs|cjs)$/.test(bare)) return undefined;
		const source = await resolveSource?.();
		if (!source || !/(?<!\.d)\.(?:ts|mts|cts)$/.test(source)) return undefined;
		await access(source);
		return pathToFileURL(source).href;
	};
	// Use Node's selected loader conditions without executing the requested package.
	let url: string;
	try {
		const { stdout } = await runImportCommand("node", [
			"--experimental-import-meta-resolve", "--input-type=module", "-e",
			mode === "require"
				? 'import {createRequire} from "node:module"; import {fileURLToPath,pathToFileURL} from "node:url"; const s=process.argv[1]; process.stdout.write(pathToFileURL(createRequire(process.argv[2]).resolve(s.startsWith("file:")?fileURLToPath(s):s)).href)'
				: "process.stdout.write(import.meta.resolve(process.argv[1], process.argv[2]))",
			bare, pathToFileURL(resolve(cwd, "__ts_import__.mjs")).href,
		], { cwd, timeout: 15_000, maxBuffer: 1024 * 1024, signal });
		url = stdout.trim();
	} catch (error) {
		signal?.throwIfAborted();
		if (mode === "require") {
			const source = await localSource();
			if (source) return source;
		}
		throw error;
	}
	if (!url.startsWith("file:") && !url.startsWith("node:")) throw new Error(`Unsupported resolved import: ${url}`);
	if (url.startsWith("file:")) {
		try { await access(fileURLToPath(url)); }
		catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
			const source = await localSource();
			if (!source) throw error;
			return source;
		}
	}
	return url;
}

async function resolveRawImport(specifier: string, options: TsImportOptions, compiler?: { api: API; runtime: TsRuntime }, mode: "import" | "require" = "import"): Promise<string> {
	const location = await importLocation(specifier, options);
	return runtimeLocation(location.bare, location.cwd, options.signal, async () => {
		const resolveSource = (owner: API, runtime: TsRuntime) => resolveTsSource(location.bare, location.cwd, owner, runtime, mode);
		return compiler ? resolveSource(compiler.api, compiler.runtime) : withTsImportApi(options, resolveSource);
	}, mode);
}

export async function resolveTsRuntimeImport(specifier: string, options: TsImportOptions): Promise<string> {
	const url = await resolveRawImport(specifier, options);
	return tsImportSourcePath(url) ? compileTsImportSource(url, options, resolveRawImport) : url;
}

/** Types use tsrs's Node resolver; runtime uses Node's import conditions, never require conditions. */
export async function resolveTsImports(specifiers: readonly string[], options: TsImportOptions): Promise<TsImportResolutions> {
	const moduleResolutions = new Map<string, string>();
	const runtimeSpecifiers = new Map<string, string>();
	const graphOptions = { ...options, sourceModules: options.sourceModules ?? new Map<string, string>() };
	if (specifiers.length === 0) return { moduleResolutions, runtimeSpecifiers };
	await withTsImportApi(options, async (api, runtime) => {
		const { ModuleKind, ModuleResolutionKind } = runtime.api;
		const resolver = await api.createModuleResolver({ module: ModuleKind.NodeNext, moduleResolution: ModuleResolutionKind.NodeNext, allowJs: true });
		try {
			for (const specifier of new Set(specifiers)) {
				const { cwd, bare } = await importLocation(specifier, options);
				const builtin = isBuiltin(bare);
				const typeName = bare.startsWith("file:") ? fileURLToPath(bare) : bare;
				const types = (await resolver.resolveModuleName(typeName, cwd, ModuleKind.ESNext)).resolvedModule;
				if (types) moduleResolutions.set(specifier, types.resolvedFileName);
				// Node built-ins are ambient declarations supplied by @types/node.
				if (!types && !builtin && /\.(?:ts|mts|cts)$/.test(typeName)) {
					const path = resolve(cwd, typeName);
					await access(path);
					moduleResolutions.set(specifier, path);
				}
				try {
					runtimeSpecifiers.set(specifier, await runtimeLocation(bare, cwd, options.signal, async () => types?.resolvedFileName));
				} catch (error) {
					options.signal?.throwIfAborted();
					// Type-only packages/exports need no executable entry. A value import still
					// resolves through the runtime bridge and reports the original failure.
					if (!types) throw error;
				}
			}
		} finally { await resolver.dispose(); }
	});
	for (const [specifier, runtime] of runtimeSpecifiers) {
		if (tsImportSourcePath(runtime)) runtimeSpecifiers.set(specifier, await compileTsImportSource(runtime, graphOptions, resolveRawImport, (name, path) => moduleResolutions.set(name, path)));
	}
	return { moduleResolutions, runtimeSpecifiers };
}

function tsImportSourcePath(url: string): string | undefined {
	if (!url.startsWith("file:")) return undefined;
	const path = fileURLToPath(url);
	return /(?<!\.d)\.(?:ts|mts|cts)$/.test(path) ? path : undefined;
}
