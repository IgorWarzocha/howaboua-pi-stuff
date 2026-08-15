import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentFleet } from "./fleet.js";
import {
	isMachineName,
	readMachinesConfig,
	writeMachinesConfig,
} from "./machines-config.js";
import { enableMasterDirectory, isMasterDirectory } from "./master-config.js";

const TOOL_NAME = "herdr_agents";

export function registerMasterMode(
	pi: ExtensionAPI,
	getFleet: () => AgentFleet,
): void {
	let fleet: AgentFleet | undefined;
	pi.registerCommand("herdr", {
		description: "Manage Herdr master mode and machines",
		getArgumentCompletions: (prefix) =>
			["master", "json", "connect"]
				.filter((action) => action.startsWith(prefix.trim().toLowerCase()))
				.map((value) => ({ label: value, value })),
		handler: async (args, ctx) => {
			const [rawAction = "", target] = args.trim().split(/\s+/, 2);
			const action = rawAction.toLowerCase();
			if (!action) {
				const activeFleet = await showHerdrMenu(pi, getFleet, ctx, fleet);
				if (activeFleet) fleet = activeFleet;
				return;
			}
			if (action === "connect") {
				if (!fleet) {
					ctx.ui.notify("Enable Herdr master mode first", "warning");
					return;
				}
				try {
					const attempted = fleet.connect(target);
					ctx.ui.notify(
						attempted.length > 0
							? `Connecting to ${attempted.join(", ")}`
							: "All configured machines are connected",
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
			if (action !== "master" && action !== "json") {
				ctx.ui.notify(
					"Usage: /herdr [master|json|connect [machine]]",
					"warning",
				);
				return;
			}
			const activeFleet = await activateMaster(pi, getFleet, ctx);
			if (!activeFleet) return;
			fleet = activeFleet;
			if (action === "master") {
				ctx.ui.notify("Herdr master enabled for this Pi session", "info");
				return;
			}
			try {
				const path = await enableMasterDirectory(ctx.cwd);
				ctx.ui.notify(`Herdr master enabled in ${path}`, "info");
			} catch (error) {
				ctx.ui.notify(
					`Herdr master is active for this session but could not save ${ctx.cwd}/.pi/shepherdr.json: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		fleet?.deactivate();
		fleet = undefined;
		let master = false;
		try {
			master = await isMasterDirectory(ctx.cwd);
		} catch (error) {
			ctx.ui.notify(
				`Herdr master config is invalid: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
		if (!master) {
			setToolActive(pi, false);
			return;
		}
		const activeFleet = await activateMaster(pi, getFleet, ctx);
		if (activeFleet) fleet = activeFleet;
	});

	pi.on("session_shutdown", async () => {
		fleet?.deactivate();
		fleet = undefined;
	});
}

async function showHerdrMenu(
	pi: ExtensionAPI,
	getFleet: () => AgentFleet,
	ctx: ExtensionContext,
	fleet: AgentFleet | undefined,
): Promise<AgentFleet | undefined> {
	const config = await readMachinesConfig().catch((error) => {
		ctx.ui.notify(
			`Shepherdr machine config is invalid: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return undefined;
	});
	if (!config) return fleet;
	const statuses =
		fleet?.statuses() ??
		Object.keys(config.machines).map((name) => ({
			local: false,
			name,
			status: "unavailable" as const,
		}));
	const options = [
		...(fleet ? [] : ["Enable master for this session"]),
		"Enable master in this folder",
		"Add machine",
		...statuses
			.filter((machine) => !machine.local)
			.map(
				(machine) =>
					`${machine.status === "connected" ? "●" : machine.status === "connecting" ? "◌" : "○"} ${machine.name} · ${machine.status}`,
			),
	];
	const selected = await ctx.ui.select("Shepherdr", options);
	if (!selected) return fleet;
	if (selected === "Enable master for this session") {
		const active = await activateMaster(pi, getFleet, ctx);
		if (active)
			ctx.ui.notify("Herdr master enabled for this Pi session", "info");
		return active ?? fleet;
	}
	if (selected === "Enable master in this folder") {
		const active = fleet ?? (await activateMaster(pi, getFleet, ctx));
		if (!active) return fleet;
		try {
			const path = await enableMasterDirectory(ctx.cwd);
			ctx.ui.notify(`Herdr master enabled in ${path}`, "info");
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
		return active;
	}
	if (selected === "Add machine") {
		await addMachine(ctx, fleet);
		return fleet;
	}
	const name = selected.slice(2).split(" · ", 1)[0];
	if (!name) return fleet;
	const status = statuses.find((machine) => machine.name === name);
	const action = await ctx.ui.select(name, [
		...(fleet && status?.status !== "connected" ? ["Connect"] : []),
		"Remove",
	]);
	if (action === "Connect") {
		fleet?.connect(name);
		ctx.ui.notify(`Connecting to ${name}`, "info");
	} else if (action === "Remove") {
		const confirmed = await ctx.ui.confirm(
			`Remove ${name}?`,
			"The remote Shepherdr helper will remain available for other controllers",
		);
		if (!confirmed) return fleet;
		delete config.machines[name];
		await writeMachinesConfig(config);
		await fleet?.reload();
		ctx.ui.notify(`Removed ${name}`, "info");
	}
	return fleet;
}

async function addMachine(
	ctx: ExtensionContext,
	fleet: AgentFleet | undefined,
): Promise<void> {
	const name = (await ctx.ui.input("Machine name", "desktop"))?.trim();
	if (!name) return;
	if (!isMachineName(name)) {
		ctx.ui.notify("Machine name must match [a-z][a-z0-9_-]{0,31}", "error");
		return;
	}
	const host = (await ctx.ui.input("SSH target", name))?.trim();
	if (!host) return;
	const session = (
		await ctx.ui.input("Herdr session", "default (leave blank)")
	)?.trim();
	const config = await readMachinesConfig();
	if (name === config.local || name in config.machines) {
		ctx.ui.notify(`Machine ${name} already exists`, "error");
		return;
	}
	config.machines[name] = {
		agentDir: "~/.pi/agent",
		command: ["ssh", "-o", "BatchMode=yes", host],
		node: "node",
		...(session && session !== "default (leave blank)" ? { session } : {}),
	};
	const path = await writeMachinesConfig(config);
	if (fleet) await fleet.reload();
	ctx.ui.notify(
		`Added ${name} in ${path}; Shepherdr manages ~/.pi/agent/shepherdr.mjs remotely`,
		"info",
	);
}

async function activateMaster(
	pi: ExtensionAPI,
	getFleet: () => AgentFleet,
	ctx: ExtensionContext,
): Promise<AgentFleet | undefined> {
	if (process.env["HERDR_ENV"] !== "1" || !process.env["HERDR_SOCKET_PATH"]) {
		setToolActive(pi, false);
		ctx.ui.notify("Herdr master mode requires Pi to run inside Herdr", "error");
		return undefined;
	}
	const fleet = getFleet();
	try {
		setToolActive(pi, true);
		await fleet.activate(ctx);
		return fleet;
	} catch (error) {
		setToolActive(pi, false);
		fleet.deactivate();
		ctx.ui.notify(
			`Herdr master could not start: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return undefined;
	}
}

function setToolActive(pi: ExtensionAPI, active: boolean): void {
	const current = pi.getActiveTools();
	const withoutTool = current.filter((name) => name !== TOOL_NAME);
	const next = active ? [...withoutTool, TOOL_NAME] : withoutTool;
	if (
		next.length !== current.length ||
		next.some((name, index) => name !== current[index])
	) {
		pi.setActiveTools(next);
	}
}
