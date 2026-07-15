import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const HOST_RELEASE = "rust-v0.144.1";
const HOST_INSTALL_TIMEOUT_MS = 270_000;

function packageRoot(): string {
	return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

export function codeModeHostBinaryPath(): string {
	const name =
		process.platform === "win32"
			? "codex-code-mode-host.exe"
			: "codex-code-mode-host";
	const bundled = join(
		packageRoot(),
		"code-mode",
		"bin",
		`${process.platform}-${process.arch}`,
		name,
	);
	if (existsSync(bundled)) return bundled;
	const development = join(
		packageRoot(),
		"code-mode",
		"vendor",
		"code-mode-src",
		"target",
		"release",
		name,
	);
	if (existsSync(development)) return development;
	const cached = codeModeHostCachePath(name);
	if (existsSync(cached)) return cached;
	throw new Error(
		`No code-mode host binary for ${process.platform}-${process.arch}. Reinstall the package or build it with \`bun run build:code-mode-host\`.`,
	);
}

export async function ensureCodeModeHostBinary(signal?: AbortSignal): Promise<string> {
	try {
		return codeModeHostBinaryPath();
	} catch {
		const script = join(
			packageRoot(),
			"scripts",
			"code-mode",
			"install-host.mjs",
		);
		const name =
			process.platform === "win32"
				? "codex-code-mode-host.exe"
				: "codex-code-mode-host";
		await execFileAsync(
			process.execPath,
			[script, codeModeHostCachePath(name)],
			{ timeout: HOST_INSTALL_TIMEOUT_MS, signal },
		);
		return codeModeHostBinaryPath();
	}
}

function codeModeHostCachePath(name: string): string {
	return join(
		getAgentDir(),
		"cache",
		"pi-codex-conversion",
		"code-mode",
		HOST_RELEASE,
		`${process.platform}-${process.arch}`,
		name,
	);
}
