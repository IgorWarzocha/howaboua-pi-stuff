import { readFile } from "node:fs/promises";
import { createRequire, findPackageJSON } from "node:module";
import { join } from "node:path";
import { cacheExactNpmImport } from "./npm-cache.ts";

interface RuntimePackage { resolve: NodeJS.RequireResolve; manifest: string }
export class RuntimeInstallError extends Error {}

/** Reuse an exact installed payload when available, otherwise install only on
 * demand. Pi may already ship the JS engine; its dependency is not our guarantee. */
export async function runtimePackage(name: string, version: string, agentDir: string, mode: string, signal?: AbortSignal): Promise<RuntimePackage> {
	signal?.throwIfAborted();
	try {
		const manifest = findPackageJSON(name, import.meta.url);
		if (manifest) {
			const value: unknown = JSON.parse(await readFile(manifest, "utf8"));
			if (value && typeof value === "object" && "name" in value && value.name === name && "version" in value && value.version === version) return { resolve: createRequire(manifest).resolve, manifest };
		}
	} catch (error) {
		if (!(error instanceof Error && "code" in error && (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "ENOENT"))) throw error;
	}
	try {
		const location = await cacheExactNpmImport(`npm:${name}@${version}`, join(agentDir, "cache", "pi-codex-conversion", "runtimes"), signal, true);
		const manifest = join(location.cwd, "node_modules", name, "package.json");
		return { resolve: createRequire(manifest).resolve, manifest };
	} catch (cause) {
		signal?.throwIfAborted();
		throw new RuntimeInstallError(`${mode} runtime installation failed. Check npm and registry access, then retry; other execution modes remain available.`, { cause });
	}
}
