import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const DEFAULT_REMOTE_NODE_PATH = "node";

export interface BrowserRouteConfig {
	aliases: Record<string, string>;
	hosts: string[];
	remoteNodePath: string;
}

interface BrowserRouteConfigInput {
	aliases?: Record<string, string>;
	hosts?: string[];
	remoteNodePath?: string;
}

const ROUTE_NAME = /^[A-Za-z0-9_.-]+$/;
const REMOTE_WORD = /^[A-Za-z0-9_./:$@=+-]+$/;

export function browserConfigPath(): string {
	const agentDir =
		process.env["PI_CODING_AGENT_DIR"]?.trim() ||
		join(homedir(), ".pi", "agent");
	return (
		process.env["PI_BROWSER_CONFIG"]?.trim() ||
		join(agentDir, "pi-browser.json")
	);
}

export function defaultBrowserRouteConfig(): BrowserRouteConfig {
	return {
		aliases: {},
		hosts: [],
		remoteNodePath: DEFAULT_REMOTE_NODE_PATH,
	};
}

export function normalizeBrowserHostName(
	value: unknown,
	field = "browser host",
): string {
	if (typeof value !== "string" || !ROUTE_NAME.test(value)) {
		throw new Error(
			`${field} must contain only letters, digits, dot, dash or underscore`,
		);
	}
	return value;
}

function remoteWord(value: unknown, field: string): string {
	if (typeof value !== "string" || !value || !REMOTE_WORD.test(value)) {
		throw new Error(`${field} contains unsupported shell characters`);
	}
	return value;
}

export function normalizeBrowserRouteConfig(
	value: unknown,
): BrowserRouteConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("pi-browser config must be an object");
	}
	const input = value as BrowserRouteConfigInput;
	const rawHosts = input.hosts ?? [];
	if (!Array.isArray(rawHosts)) {
		throw new Error("pi-browser config hosts must be an array");
	}
	const hosts = rawHosts.map((name) =>
		normalizeBrowserHostName(name, "pi-browser host name"),
	);
	if (new Set(hosts).size !== hosts.length) {
		throw new Error("pi-browser config hosts must be unique");
	}
	const rawAliases = input.aliases ?? {};
	if (typeof rawAliases !== "object" || Array.isArray(rawAliases)) {
		throw new Error("pi-browser config aliases must be an object");
	}
	const aliases: Record<string, string> = {};
	for (const [rawAlias, rawTarget] of Object.entries(rawAliases)) {
		const alias = normalizeBrowserHostName(rawAlias, "pi-browser alias");
		const target = normalizeBrowserHostName(
			rawTarget,
			`pi-browser alias ${alias}`,
		);
		if (!hosts.includes(target)) {
			throw new Error(
				`pi-browser alias ${alias} targets unknown host ${target}`,
			);
		}
		aliases[alias] = target;
	}
	return {
		aliases,
		hosts,
		remoteNodePath: remoteWord(
			input.remoteNodePath ?? DEFAULT_REMOTE_NODE_PATH,
			"pi-browser remoteNodePath",
		),
	};
}

export function readBrowserRouteConfig(
	path = browserConfigPath(),
): BrowserRouteConfig {
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return defaultBrowserRouteConfig();
		}
		throw error;
	}
	try {
		return normalizeBrowserRouteConfig(JSON.parse(source));
	} catch (error) {
		throw new Error(
			`Invalid pi-browser config at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function writeBrowserRouteConfig(
	config: BrowserRouteConfig,
	path = browserConfigPath(),
): void {
	const normalized = normalizeBrowserRouteConfig(config);
	if (normalized.hosts.length === 0) {
		rmSync(path, { force: true });
		return;
	}
	const directory = dirname(path);
	mkdirSync(directory, { recursive: true });
	const temporary = join(
		directory,
		`.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
	);
	try {
		writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}
