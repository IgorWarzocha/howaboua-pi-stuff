import { existsSync } from "node:fs";
import { dirname, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const PATH_TOOL_WRAPPERS = ["apply_patch", "view_image", "web_run", "imagegen"].map((name) =>
	process.platform === "win32" ? `${name}.cmd` : name,
);

const TOOL_DIRS: Record<string, string> = {
	apply_patch: "apply-patch",
	exec_bridge: "exec",
	imagegen: "imagegen",
	view_image: "view-image",
	web_run: "web-run",
};

export const CUSTOM_RUST_BINARIES_DIR_ENV = "PI_CODEX_CUSTOM_RUST_BINARIES_DIR";

function packageRoot(): string {
	return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

export function getBundledPathToolsBinDir(): string {
	return join(packageRoot(), "bin");
}

export function getBundledPathToolBinaryPath(toolName: string, target: { platform?: NodeJS.Platform; arch?: string } = {}, customDir?: string | undefined): string | undefined {
	const toolDir = TOOL_DIRS[toolName] ?? toolName;
	const platform = target.platform ?? process.platform;
	const arch = target.arch ?? process.arch;
	const exe = platform === "win32" ? `${toolName}.exe` : toolName;
	const custom = customDir?.trim();
	if (custom) {
		const customBinary = join(custom, exe);
		if (existsSync(customBinary)) return customBinary;
	}
	const binary = join(packageRoot(), "src", "tools", toolDir, "bin", `${platform}-${arch}`, exe);
	return existsSync(binary) ? binary : undefined;
}

function pathEnvKey(env: NodeJS.ProcessEnv): string {
	if (process.platform !== "win32") return "PATH";
	return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

export function createBundledPathToolsEnv(baseEnv: NodeJS.ProcessEnv = process.env, customDir?: string | undefined): NodeJS.ProcessEnv {
	const binDir = getBundledPathToolsBinDir();
	if (!PATH_TOOL_WRAPPERS.some((wrapper) => existsSync(join(binDir, wrapper)))) return { ...baseEnv };
	const env = { ...baseEnv };
	const custom = customDir?.trim();
	if (custom) env[CUSTOM_RUST_BINARIES_DIR_ENV] = custom;
	else delete env[CUSTOM_RUST_BINARIES_DIR_ENV];
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
