import { hostname } from "node:os";
import {
	type BrowserRouteConfig,
	normalizeBrowserRouteConfig,
	readBrowserRouteConfig,
} from "./config.js";

export interface BrowserRemoteCommand {
	nodePath: string;
	toolPath: string;
}

export interface BrowserRoute {
	local: boolean;
	name: string;
	remote?: BrowserRemoteCommand;
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

function routesFromConfig(
	config: BrowserRouteConfig,
	currentHostname: string,
): BrowserRoutes {
	const shortHostname = currentHostname.split(".")[0] ?? currentHostname;
	const currentName =
		config.aliases[currentHostname] ??
		config.aliases[shortHostname] ??
		shortHostname;
	const remote = {
		nodePath: config.remoteNodePath,
		toolPath: config.remoteToolPath,
	};
	const routes = new Map<string, BrowserRoute>();
	for (const name of config.hosts) {
		const local = currentName === name;
		routes.set(name, local ? { name, local } : { name, local, remote });
	}
	return new BrowserRoutes(routes);
}

export function parseBrowserRoutes(
	value: unknown,
	currentHostname = hostname(),
): BrowserRoutes {
	return routesFromConfig(normalizeBrowserRouteConfig(value), currentHostname);
}

export function loadBrowserRoutes(
	path?: string,
	currentHostname = hostname(),
): BrowserRoutes {
	return routesFromConfig(readBrowserRouteConfig(path), currentHostname);
}
