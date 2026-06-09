import { existsSync } from "node:fs";
import { dirname, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const PATH_TOOL_WRAPPERS = ["apply_patch", "view_image", "web_run", "imagegen"].map((name) =>
	process.platform === "win32" ? `${name}.cmd` : name,
);

const TOOL_DIRS: Record<string, string> = {
	exec_bridge: "exec",
	imagegen: "imagegen",
	view_image: "view-image",
	web_run: "web-run",
};

function packageRoot(): string {
	return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

export function getBundledPathToolsBinDir(): string {
	return join(packageRoot(), "bin");
}

export function getBundledPathToolBinaryPath(toolName: string): string | undefined {
	const toolDir = TOOL_DIRS[toolName] ?? toolName;
	const exe = process.platform === "win32" ? `${toolName}.exe` : toolName;
	const binary = join(packageRoot(), "src", "tools", toolDir, "bin", `${process.platform}-${process.arch}`, exe);
	return existsSync(binary) ? binary : undefined;
}

function pathEnvKey(env: NodeJS.ProcessEnv): string {
	if (process.platform !== "win32") return "PATH";
	return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

export function createBundledPathToolsEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const binDir = getBundledPathToolsBinDir();
	if (!PATH_TOOL_WRAPPERS.some((wrapper) => existsSync(join(binDir, wrapper)))) return { ...baseEnv };
	const env = { ...baseEnv };
	const key = pathEnvKey(env);
	const currentPath = env[key] ?? "";
	const entries = currentPath.split(delimiter).filter(Boolean);
	if (!entries.includes(binDir)) env[key] = [binDir, ...entries].join(delimiter);
	return env;
}

export function ensureBundledPathToolsOnPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const binDir = getBundledPathToolsBinDir();
	if (!PATH_TOOL_WRAPPERS.some((wrapper) => existsSync(join(binDir, wrapper)))) return undefined;
	const key = pathEnvKey(env);
	const currentPath = env[key] ?? "";
	const entries = currentPath.split(delimiter).filter(Boolean);
	if (!entries.includes(binDir)) env[key] = [binDir, ...entries].join(delimiter);
	return binDir;
}
