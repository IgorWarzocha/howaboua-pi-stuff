import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { codeModeHostBinaryName, HOST_RELEASE } from "./host-assets.ts";
import { installCodeModeHost, type InstallCodeModeHostOptions } from "./install-host.ts";

interface CodeModeHostBinaryRuntime {
	platform: string;
	arch: string;
	agentDir: string;
	install(options: InstallCodeModeHostOptions): Promise<void>;
}

function resolveRuntime(overrides: Partial<CodeModeHostBinaryRuntime> = {}): CodeModeHostBinaryRuntime {
	return {
		platform: overrides.platform ?? process.platform,
		arch: overrides.arch ?? process.arch,
		agentDir: overrides.agentDir ?? getAgentDir(),
		install: overrides.install ?? installCodeModeHost,
	};
}

export function codeModeHostBinaryPath(overrides: Partial<CodeModeHostBinaryRuntime> = {}): string {
	const runtime = resolveRuntime(overrides);
	const name = codeModeHostBinaryName(runtime.platform);
	const cached = codeModeHostCachePath(name, runtime);
	if (existsSync(cached)) return cached;
	throw new Error(
		`No code-mode host binary for ${runtime.platform}-${runtime.arch}. Reinstall the package to download the supported runtime.`,
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
