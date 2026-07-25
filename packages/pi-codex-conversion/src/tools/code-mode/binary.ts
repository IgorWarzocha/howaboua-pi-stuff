import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { codeModeHostBinaryName, HOST_RELEASE } from "./host-assets.ts";
import { installCodeModeHost, type InstallCodeModeHostOptions } from "./install-host.ts";

interface CodeModeHostBinaryRuntime {
	platform: string;
	arch: string;
	packageRoot: string;
	agentDir: string;
	install(options: InstallCodeModeHostOptions): Promise<void>;
}

function packageRoot(): string {
	return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

function resolveRuntime(overrides: Partial<CodeModeHostBinaryRuntime> = {}): CodeModeHostBinaryRuntime {
	return {
		platform: overrides.platform ?? process.platform,
		arch: overrides.arch ?? process.arch,
		packageRoot: overrides.packageRoot ?? packageRoot(),
		agentDir: overrides.agentDir ?? getAgentDir(),
		install: overrides.install ?? installCodeModeHost,
	};
}

export function codeModeHostBinaryPath(overrides: Partial<CodeModeHostBinaryRuntime> = {}): string {
	const runtime = resolveRuntime(overrides);
	const name = codeModeHostBinaryName(runtime.platform);
	const bundled = join(
		runtime.packageRoot,
		"code-mode",
		"bin",
		`${runtime.platform}-${runtime.arch}`,
		name,
	);
	if (existsSync(bundled)) return bundled;
	const development = join(
		runtime.packageRoot,
		"code-mode",
		"vendor",
		"code-mode-src",
		"target",
		"release",
		name,
	);
	if (existsSync(development)) return development;
	const cached = codeModeHostCachePath(name, runtime);
	if (existsSync(cached)) return cached;
	throw new Error(
		`No code-mode host binary for ${runtime.platform}-${runtime.arch}. Reinstall the package or build it with \`bun run build:code-mode-host\``,
	);
}

export async function ensureCodeModeHostBinary(signal?: AbortSignal, overrides: Partial<CodeModeHostBinaryRuntime> = {}): Promise<string> {
	const runtime = resolveRuntime(overrides);
	try {
		return codeModeHostBinaryPath(runtime);
	} catch {
		const name = codeModeHostBinaryName(runtime.platform);
		await runtime.install({
			destination: codeModeHostCachePath(name, runtime),
			platform: runtime.platform,
			arch: runtime.arch,
			...(signal ? { signal } : {}),
		});
		return codeModeHostBinaryPath(runtime);
	}
}

function codeModeHostCachePath(name: string, runtime: CodeModeHostBinaryRuntime): string {
	return join(
		runtime.agentDir,
		"cache",
		"pi-codex-conversion",
		"code-mode",
		HOST_RELEASE,
		`${runtime.platform}-${runtime.arch}`,
		name,
	);
}
