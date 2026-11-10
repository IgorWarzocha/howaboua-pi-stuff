import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ViewerConfig {
	host: string;
	port: number;
	publicUrl: string;
	openCommand: string[] | null;
}

export function stateDirectory(): string {
	return join(
		process.env["PI_CODING_AGENT_DIR"] || join(homedir(), ".pi", "agent"),
		"board-viewer",
	);
}

function configPath(): string {
	return join(stateDirectory(), "config.json");
}

export async function loadConfig(): Promise<ViewerConfig> {
	let value: unknown;
	try {
		value = JSON.parse(await readFile(configPath(), "utf8"));
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
		value = {};
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Viewer config must be an object");
	const config = value as Record<string, unknown>;
	const host = config["host"] ?? "127.0.0.1";
	const port = config["port"] ?? 47984;
	if (typeof host !== "string" || !["127.0.0.1", "0.0.0.0"].includes(host))
		throw new Error("Viewer host must be 127.0.0.1 or 0.0.0.0");
	if (
		typeof port !== "number" ||
		!Number.isInteger(port) ||
		port < 1024 ||
		port > 65535
	)
		throw new Error("Viewer port must be an integer from 1024 to 65535");
	const publicUrl = config["publicUrl"] ?? `http://127.0.0.1:${port}`;
	if (typeof publicUrl !== "string")
		throw new Error("Viewer publicUrl must be an HTTP or HTTPS origin");
	const url = new URL(publicUrl);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new Error(
			"Viewer publicUrl must be an HTTP or HTTPS origin without a path",
		);
	const command = config["openCommand"];
	if (
		command !== undefined &&
		command !== null &&
		(!Array.isArray(command) ||
			!command.length ||
			!command.every((part) => typeof part === "string" && part.length > 0))
	)
		throw new Error(
			"Viewer openCommand must be an argument array, or null for link only",
		);
	const defaultCommand =
		process.platform === "darwin"
			? ["open"]
			: process.platform === "win32"
				? ["rundll32", "url.dll,FileProtocolHandler"]
				: ["xdg-open"];
	return {
		host,
		port,
		publicUrl: url.origin,
		openCommand:
			command === null
				? null
				: command === undefined
					? defaultCommand
					: (command as string[]),
	};
}

export async function accessKey(): Promise<string> {
	const directory = stateDirectory();
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, "access-key");
	try {
		await writeFile(path, randomBytes(32).toString("hex"), {
			flag: "wx",
			mode: 0o600,
		});
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
			throw error;
	}
	const key = (await readFile(path, "utf8")).trim();
	if (!/^[a-f0-9]{64}$/.test(key))
		throw new Error(
			"Invalid viewer access key; remove the access-key file and restart the viewer",
		);
	return key;
}
