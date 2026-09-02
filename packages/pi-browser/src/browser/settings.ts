import { hostname } from "node:os";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	type BrowserRouteConfig,
	browserConfigPath,
	defaultBrowserRouteConfig,
	normalizeBrowserHostName,
	normalizeBrowserRouteConfig,
	readBrowserRouteConfig,
	writeBrowserRouteConfig,
} from "./config.js";

const BACK = "Back";
const CANCEL = "Cancel";
const SAVE = "Save and reload";

function currentMachineRoute(config: BrowserRouteConfig): string | undefined {
	const full = hostname();
	const short = full.split(".")[0] ?? full;
	return (
		config.aliases[full] ??
		config.aliases[short] ??
		(config.hosts.includes(short) ? short : undefined)
	);
}

function setCurrentMachineRoute(
	config: BrowserRouteConfig,
	name: string | undefined,
): BrowserRouteConfig {
	const full = hostname();
	const short = full.split(".")[0] ?? full;
	const aliases = { ...config.aliases };
	delete aliases[full];
	delete aliases[short];
	if (name && name !== short) aliases[short] = name;
	return { ...config, aliases };
}

function compactPath(value: string): string {
	return value.length <= 48 ? value : `…${value.slice(-47)}`;
}

async function manageHosts(
	ctx: ExtensionCommandContext,
	initial: BrowserRouteConfig,
): Promise<BrowserRouteConfig> {
	let config = initial;
	while (true) {
		const removals = new Map(
			config.hosts.map((host) => [`Remove · ${host}`, host]),
		);
		const selected = await ctx.ui.select("Browser hosts", [
			"Add SSH host",
			...removals.keys(),
			BACK,
		]);
		if (!selected || selected === BACK) return config;
		if (selected === "Add SSH host") {
			const input = (await ctx.ui.input("SSH host name", "laptop"))?.trim();
			if (!input) continue;
			try {
				const host = normalizeBrowserHostName(input, "SSH host name");
				if (config.hosts.includes(host)) {
					ctx.ui.notify(`Browser host ${host} already exists`, "warning");
					continue;
				}
				config = { ...config, hosts: [...config.hosts, host] };
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
			continue;
		}
		const host = removals.get(selected);
		if (!host) continue;
		if (
			!(await ctx.ui.confirm(
				"Remove browser host",
				`Remove ${host} from browser routing?`,
			))
		) {
			continue;
		}
		const aliases = Object.fromEntries(
			Object.entries(config.aliases).filter(([, target]) => target !== host),
		);
		config = {
			...config,
			aliases,
			hosts: config.hosts.filter((candidate) => candidate !== host),
		};
	}
}

async function manageAdvanced(
	ctx: ExtensionCommandContext,
	initial: BrowserRouteConfig,
): Promise<BrowserRouteConfig> {
	let config = initial;
	while (true) {
		const node = `Remote Node · ${compactPath(config.remoteNodePath)}`;
		const selected = await ctx.ui.select("Advanced browser routing", [
			node,
			BACK,
		]);
		if (!selected || selected === BACK) return config;
		const value = (
			await ctx.ui.input("Remote Node path", config.remoteNodePath)
		)?.trim();
		if (!value) continue;
		try {
			config = normalizeBrowserRouteConfig({
				...config,
				remoteNodePath: value,
			});
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	}
}

async function initialConfig(
	ctx: ExtensionCommandContext,
): Promise<BrowserRouteConfig | undefined> {
	try {
		return readBrowserRouteConfig();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const reset = await ctx.ui.confirm(
			"Invalid browser settings",
			`${message}\n\nReset them?`,
		);
		return reset ? defaultBrowserRouteConfig() : undefined;
	}
}

async function openBrowserSettings(
	ctx: ExtensionCommandContext,
): Promise<void> {
	let config = await initialConfig(ctx);
	if (!config) return;
	while (true) {
		const hosts = `Hosts · ${config.hosts.length ? config.hosts.join(", ") : "local only"}`;
		const machine = `This machine · ${currentMachineRoute(config) ?? "unnamed local"}`;
		const selected = await ctx.ui.select("Browser settings", [
			hosts,
			machine,
			"Advanced",
			SAVE,
			CANCEL,
		]);
		if (!selected || selected === CANCEL) return;
		if (selected === hosts) {
			config = await manageHosts(ctx, config);
			continue;
		}
		if (selected === machine) {
			const route = await ctx.ui.select("This machine", [
				"Unnamed local browser",
				...config.hosts,
			]);
			if (route) {
				config = setCurrentMachineRoute(
					config,
					route === "Unnamed local browser" ? undefined : route,
				);
			}
			continue;
		}
		if (selected === "Advanced") {
			config = await manageAdvanced(ctx, config);
			continue;
		}
		try {
			writeBrowserRouteConfig(config);
			ctx.ui.notify("Browser settings saved; reloading Pi", "info");
			await ctx.reload();
			return;
		} catch (error) {
			ctx.ui.notify(
				`Could not save browser settings: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	}
}

export function registerBrowserCommand(pi: ExtensionAPI): void {
	pi.registerCommand("browser", {
		description: "Configure browser host routing",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI || ctx.mode !== "tui") {
				try {
					const config = readBrowserRouteConfig();
					ctx.ui.notify(
						`Browser: ${config.hosts.length ? config.hosts.join(", ") : "local only"}\nConfig: ${browserConfigPath()}`,
						"info",
					);
				} catch (error) {
					ctx.ui.notify(
						error instanceof Error ? error.message : String(error),
						"error",
					);
				}
				return;
			}
			await openBrowserSettings(ctx);
		},
	});
}
