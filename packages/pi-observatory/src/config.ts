import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { hash, object } from "./normalise.ts";

export const PROTOCOL = "pi-observatory/2";

export interface ObservatoryConfig {
	host: "127.0.0.1" | "0.0.0.0";
	port: number;
	publicUrl: string;
	openCommand: string[] | null;
	sessions: string;
	database: string;
	tabs: string[];
}

export function stateDirectory(): string {
	return join(
		process.env["PI_CODING_AGENT_DIR"] || join(homedir(), ".pi", "agent"),
		"observatory",
	);
}

export async function loadConfig(
	overrides: {
		sessions?: string | undefined;
		db?: string | undefined;
		port?: string | undefined;
	} = {},
): Promise<ObservatoryConfig> {
	let value: unknown = {};
	try {
		value = JSON.parse(
			await readFile(join(stateDirectory(), "config.json"), "utf8"),
		);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Observatory config must be an object");
	const config = object(value);
	const host = config["host"] ?? "127.0.0.1";
	if (host !== "127.0.0.1" && host !== "0.0.0.0")
		throw new Error("Observatory host must be 127.0.0.1 or 0.0.0.0");
	const port =
		overrides.port === undefined
			? (config["port"] ?? 47985)
			: Number(overrides.port);
	if (
		typeof port !== "number" ||
		!Number.isInteger(port) ||
		port < (overrides.port === undefined ? 1 : 0) ||
		port > 65535
	)
		throw new Error("Invalid Observatory port");
	const publicUrl = config["publicUrl"] ?? `http://127.0.0.1:${port}`;
	if (typeof publicUrl !== "string")
		throw new Error("Observatory publicUrl must be an HTTP or HTTPS origin");
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
			"Observatory publicUrl must be an HTTP or HTTPS origin without a path",
		);
	const command = config["openCommand"];
	if (
		command !== undefined &&
		command !== null &&
		(!Array.isArray(command) ||
			!command.length ||
			!command.every((item) => typeof item === "string" && item.length > 0))
	)
		throw new Error(
			"Observatory openCommand must be a nonempty argument array or null",
		);
	const configuredPath = (key: string, fallback: string) => {
		const path = config[key] ?? fallback;
		if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0"))
			throw new Error(`Observatory ${key} must be an absolute path`);
		return path;
	};
	const tabs = config["tabs"] === undefined ? [] : config["tabs"];
	if (
		!Array.isArray(tabs) ||
		!tabs.every(
			(path) =>
				typeof path === "string" && isAbsolute(path) && !path.includes("\0"),
		)
	)
		throw new Error(
			"Observatory tabs must be an array of absolute bundle paths",
		);
	return {
		host,
		port,
		publicUrl: url.origin,
		openCommand:
			command === null
				? null
				: ((command as string[] | undefined) ??
					(process.platform === "darwin"
						? ["open"]
						: process.platform === "win32"
							? ["rundll32", "url.dll,FileProtocolHandler"]
							: ["xdg-open"])),
		sessions: overrides.sessions
			? resolve(overrides.sessions)
			: configuredPath("sessions", join(stateDirectory(), "..", "sessions")),
		database: overrides.db
			? resolve(overrides.db)
			: configuredPath("database", join(stateDirectory(), "index.sqlite")),
		tabs,
	};
}

export function sourceId(config: ObservatoryConfig): string {
	return hash(
		JSON.stringify([resolve(config.sessions), resolve(config.database)]),
	);
}
