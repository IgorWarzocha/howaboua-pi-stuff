import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

export interface BrowserRemoteCommand {
	nodePath: string;
	toolPath: string;
}

export interface BrowserRoute {
	local: boolean;
	name: string;
	remote?: BrowserRemoteCommand;
}

interface BrowserRouteConfig {
	aliases?: Record<string, string>;
	hosts: string[];
	remoteNodePath?: string;
	remoteToolPath?: string;
}

const ROUTE_NAME = /^[A-Za-z0-9_.-]+$/;
const REMOTE_WORD = /^[A-Za-z0-9_./:$@=+-]+$/;

function routeName(value: unknown, field: string): string {
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

export class BrowserRoutes {
	readonly names: readonly string[];
	private readonly routes: ReadonlyMap<string, BrowserRoute>;

	constructor(routes: ReadonlyMap<string, BrowserRoute> = new Map()) {
		this.routes = routes;
		this.names = [...routes.keys()];
	}

	resolve(name: string): BrowserRoute {
		const route = this.routes.get(name);
		if (route) return route;
		if (this.names.length === 0) {
			throw new Error("Browser host routing is disabled");
		}
		throw new Error(`browser host must be one of: ${this.names.join(", ")}`);
	}
}

export function parseBrowserRoutes(
	value: unknown,
	currentHostname = hostname(),
): BrowserRoutes {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("pi-browser config must be an object");
	}
	const config = value as Partial<BrowserRouteConfig>;
	if (!Array.isArray(config.hosts) || config.hosts.length === 0) {
		throw new Error("pi-browser config hosts must be a non-empty array");
	}
	const aliases = config.aliases ?? {};
	if (typeof aliases !== "object" || Array.isArray(aliases)) {
		throw new Error("pi-browser config aliases must be an object");
	}
	const canonicalNames = new Map<string, string>();
	for (const [alias, target] of Object.entries(aliases)) {
		canonicalNames.set(
			routeName(alias, "pi-browser alias"),
			routeName(target, `pi-browser alias ${alias}`),
		);
	}
	const names = config.hosts.map((name) =>
		routeName(name, "pi-browser host name"),
	);
	if (new Set(names).size !== names.length) {
		throw new Error("pi-browser config hosts must be unique");
	}
	for (const [alias, target] of canonicalNames) {
		if (!names.includes(target)) {
			throw new Error(
				`pi-browser alias ${alias} targets unknown host ${target}`,
			);
		}
	}
	const shortHostname = currentHostname.split(".")[0] ?? currentHostname;
	const currentName =
		canonicalNames.get(currentHostname) ??
		canonicalNames.get(shortHostname) ??
		shortHostname;
	const hasRemote = names.some((name) => name !== currentName);
	const remote = hasRemote
		? {
				nodePath: remoteWord(
					config.remoteNodePath,
					"pi-browser remoteNodePath",
				),
				toolPath: remoteWord(
					config.remoteToolPath,
					"pi-browser remoteToolPath",
				),
			}
		: undefined;
	const routes = new Map<string, BrowserRoute>();
	for (const name of names) {
		const local = currentName === name;
		if (local) {
			routes.set(name, { name, local: true });
			continue;
		}
		if (!remote) throw new Error("pi-browser remote command is missing");
		routes.set(name, { name, local: false, remote });
	}
	return new BrowserRoutes(routes);
}

function browserRoutesPath(): string {
	const agentDir =
		process.env["PI_CODING_AGENT_DIR"]?.trim() ||
		join(homedir(), ".pi", "agent");
	return (
		process.env["PI_BROWSER_CONFIG"]?.trim() ||
		join(agentDir, "pi-browser.json")
	);
}

export function loadBrowserRoutes(path = browserRoutesPath()): BrowserRoutes {
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
			return new BrowserRoutes();
		}
		throw error;
	}
	try {
		return parseBrowserRoutes(JSON.parse(source));
	} catch (error) {
		throw new Error(
			`Invalid pi-browser config at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
