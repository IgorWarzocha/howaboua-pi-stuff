import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function packageRoot(): string {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function codeModeHostBinaryPath(): string {
	const name =
		process.platform === "win32"
			? "codex-code-mode-host.exe"
			: "codex-code-mode-host";
	const bundled = join(
		packageRoot(),
		"bin",
		`${process.platform}-${process.arch}`,
		name,
	);
	if (existsSync(bundled)) return bundled;
	const development = join(
		packageRoot(),
		"vendor",
		"code-mode-src",
		"target",
		"release",
		name,
	);
	if (existsSync(development)) return development;
	throw new Error(
		`No code-mode host binary for ${process.platform}-${process.arch}. Reinstall the package or build it with \`bun run build:host\`.`,
	);
}

export async function ensureCodeModeHostBinary(): Promise<string> {
	try {
		return codeModeHostBinaryPath();
	} catch {
		const script = join(packageRoot(), "scripts", "install-host.mjs");
		await execFileAsync(process.execPath, [script]);
		return codeModeHostBinaryPath();
	}
}
