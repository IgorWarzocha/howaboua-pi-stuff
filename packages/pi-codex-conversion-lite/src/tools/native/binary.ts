import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_DIRS: Record<string, string> = {
	exec_bridge: "exec",
	imagegen: "imagegen",
	view_image: "view-image",
	web_run: "web-run",
};

function packageRoot(): string {
	return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

export function getBundledToolBinaryPath(toolName: string, target: { platform?: NodeJS.Platform; arch?: string } = {}): string | undefined {
	const toolDir = TOOL_DIRS[toolName] ?? toolName;
	const platform = target.platform ?? process.platform;
	const arch = target.arch ?? process.arch;
	const exe = platform === "win32" ? `${toolName}.exe` : toolName;
	const binary = join(packageRoot(), "src", "tools", toolDir, "bin", `${platform}-${arch}`, exe);
	return existsSync(binary) ? binary : undefined;
}
