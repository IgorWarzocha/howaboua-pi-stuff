import { spawnSync } from "node:child_process";

export interface RunBundledToolOptions {
	binary: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv | undefined;
	maxBuffer?: number | undefined;
}

export interface BundledToolResult {
	stdout: string;
	stderr: string;
	status: number | null;
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

export function runBundledTool({ binary, args, cwd, env, maxBuffer }: RunBundledToolOptions): BundledToolResult {
	const child = spawnSync(binary, args, {
		cwd,
		env: env ?? process.env,
		encoding: "utf8",
		maxBuffer: maxBuffer ?? DEFAULT_MAX_BUFFER,
	});
	if (child.error) throw child.error;
	return { stdout: child.stdout ?? "", stderr: child.stderr ?? "", status: child.status };
}

export function parseSingleJsonLine<T>(stdout: string, label: string): T {
	const jsonLine = stdout
		.trimEnd()
		.split("\n")
		.findLast((line) => line.trimStart().startsWith("{"));
	if (!jsonLine) throw new Error(`${label} did not return structured JSON output`);
	return JSON.parse(jsonLine) as T;
}
