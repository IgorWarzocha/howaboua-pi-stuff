import {
	mkdir,
	open,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import {
	configSchema,
	recordSchema,
	type SandboxConfig,
	type SandboxRecord,
} from "./contracts.ts";

export function stateRoot(): string {
	return resolve(
		process.env["PI_SANDBOX_HOME"] ??
			join(
				process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"),
				"pi-sandbox",
			),
	);
}
export function directory(
	root: string,
	kind: "instances" | "templates",
	name: string,
): string {
	return join(root, kind, name);
}
export async function saveJson(path: string, value: unknown): Promise<void> {
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o600,
	});
	await rename(temporary, path);
}
export async function readRecord(dir: string): Promise<SandboxRecord> {
	return recordSchema.parse(
		JSON.parse(await readFile(join(dir, "record.json"), "utf8")),
	);
}
export async function loadConfig(path: string): Promise<SandboxConfig> {
	if ((await stat(path)).size > 1048576)
		throw new Error(
			"Environment YAML exceeds 1 MiB. Use guest files for large setup scripts",
		);
	const document = parseDocument(await readFile(path, "utf8"), {
		uniqueKeys: true,
	});
	if (document.errors.length)
		throw new Error(`Invalid YAML: ${document.errors[0]?.message}`);
	const config = configSchema.parse(document.toJS({ maxAliasCount: 20 }));
	if (config.image) config.image = resolve(path, "..", config.image);
	return config;
}
export async function privateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	if ((await stat(path)).mode & 0o077)
		throw new Error(
			"Sandbox state requires a private directory. Ask the user to choose a private PI_SANDBOX_HOME directory",
		);
}

export async function readLogTail(
	path: string,
	lines: number,
): Promise<{ output: string; truncated: boolean }> {
	let file;
	try {
		file = await open(path, "r");
	} catch (error) {
		if (existsError(error, "ENOENT")) return { output: "", truncated: false };
		throw error;
	}
	try {
		const { size } = await file.stat();
		const buffer = Buffer.alloc(Math.min(size, 65536));
		const { bytesRead } = await file.read(
			buffer,
			0,
			buffer.length,
			Math.max(0, size - buffer.length),
		);
		const text = buffer.subarray(0, bytesRead).toString("utf8");
		return {
			output: text.split("\n").slice(-lines).join("\n"),
			truncated: size > bytesRead || text.split("\n").length > lines,
		};
	} finally {
		await file.close();
	}
}
export function existsError(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function agentError(error: unknown): unknown {
	const code =
		error instanceof Error && error.name === "AbortError"
			? "ABORT_ERR"
			: error instanceof Error && "code" in error
				? error.code
				: undefined;
	const recovery: Record<string, string> = {
		ENOENT:
			"A required sandbox file or program is missing. Check the supplied config or instance name, then retry",
		EACCES: "Sandbox access was denied. Ask the user to check file permissions",
		EPERM:
			"Sandbox operation was not permitted. Ask the user to check host permissions",
		ENOSPC:
			"The host has no space for sandbox data. Ask the user to free disk space before retrying",
		EROFS:
			"Sandbox storage is read-only. Ask the user to check the storage location",
		EADDRINUSE:
			"A sandbox listening address is occupied. Inspect running instances before retrying",
		ECONNREFUSED:
			"Sandbox controller is unavailable. Use inspect and controller logs before retrying",
		ECONNRESET:
			"Sandbox connection was interrupted. Use inspect before retrying",
		ABORT_ERR:
			"Sandbox wait was cancelled. Cancellation does not stop the controller or guest work. Use inspect or exec-status",
	};
	return typeof code === "string" && recovery[code]
		? new Error(recovery[code])
		: error;
}
