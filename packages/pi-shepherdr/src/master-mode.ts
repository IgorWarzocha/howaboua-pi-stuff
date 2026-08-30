import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentFleet } from "./fleet.js";
import {
	isMachineName,
	LOCAL_MACHINE,
	readMachinesConfig,
	writeMachinesConfig,
} from "./machines-config.js";
import { enableMasterDirectory, isMasterDirectory } from "./master-config.js";

interface MasterModeOptions {
	orchestrationInstruction?: string;
	onActiveChange?(): void;
	toolName?: string;
}

const ORCHESTRATION_STATE_TYPE = "pi-shepherdr-orchestration-state";

function parseSshArguments(value: string): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	let started = false;
	for (const character of value) {
		if (escaped) {
			current += character;
			escaped = false;
			started = true;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			started = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else current += character;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			started = true;
		} else if (/\s/.test(character)) {
			if (started) {
				parts.push(current);
				current = "";
				started = false;
			}
		} else {
			current += character;
			started = true;
		}
	}
	if (quote) throw new Error("SSH arguments contain an unclosed quote");
	if (escaped) throw new Error("SSH arguments end with an incomplete escape");
	if (started) parts.push(current);
	if (parts.length === 0) throw new Error("SSH target is required");
	const target = parts.pop()!;
	return [...parts, "--", target];
}

export function registerMasterMode(
	pi: ExtensionAPI,
	fleet: AgentFleet,
	options: MasterModeOptions = {},
): void {
	let orchestrationEnabled = false;
	const toolName = options.toolName ?? "herdr_agents";
	const setActive = (active: boolean) => {
		setToolActive(pi, toolName, active);
		options.onActiveChange?.();
	};
	pi.registerCommand("herdr", {
		description: options.orchestrationInstruction
			? "Toggle Herdr orchestration mode"
			: "Manage Herdr master mode and machines",
		getArgumentCompletions: (prefix) =>
			["machines", "master", "json", "connect"]
				.filter((action) => action.startsWith(prefix.trim().toLowerCase()))
				.map((value) => ({ label: value, value })),
		handler: async (args, ctx) => {
			const [rawAction = "", ...rest] = args.trim().split(/\s+/);
			const action = rawAction.toLowerCase();
			const target = rest[0];
			if (!action) {
				if (options.orchestrationInstruction) {
					orchestrationEnabled = restoreOrchestrationMode(ctx).enabled;
					if (
						!fleet.isActive() &&
						!(await activateMaster(fleet, ctx, setActive))
					) {
						return;
					}
					orchestrationEnabled = !orchestrationEnabled;
					pi.sendMessage(
						{
							customType: ORCHESTRATION_STATE_TYPE,
							content: orchestrationEnabled
								? "Herdr orchestration mode enabled."
								: "Herdr normal mode enabled.",
							details: { enabled: orchestrationEnabled },
							display: false,
						},
						{ triggerTurn: false },
					);
					ctx.ui.notify(
						orchestrationEnabled
							? "Herdr orchestration enabled"
							: "Herdr normal mode enabled",
						"info",
					);
					return;
				}
				await showHerdrMenu(fleet, ctx, setActive);
				return;
			}
			if (action === "machines") {
				await showHerdrMenu(fleet, ctx, setActive);
				return;
			}
			if (action === "connect") {
				if (!fleet.isActive()) {
					ctx.ui.notify("Enable Herdr master mode first", "warning");
					return;
				}
				try {
					ctx.ui.notify(fleet.connect(target), "info");
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
					"Usage: /herdr [machines|master|json|connect [machine]]",
					"warning",
				);
				return;
			}
			if (!(await activateMaster(fleet, ctx, setActive))) return;
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

	pi.on("before_agent_start", (event) => {
		if (
			!orchestrationEnabled ||
			!options.orchestrationInstruction ||
			!fleet.isActive()
		)
			return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${options.orchestrationInstruction}`,
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		const orchestration = restoreOrchestrationMode(ctx);
		orchestrationEnabled = orchestration.enabled;
		fleet.deactivate();
		let master = orchestration.recorded;
		try {
			master = (await isMasterDirectory(ctx.cwd)) || master;
		} catch (error) {
			ctx.ui.notify(
				`Herdr master config is invalid: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
		if (!master) {
			setActive(false);
			return;
		}
		await activateMaster(fleet, ctx, setActive);
	});

	pi.on("session_shutdown", async () => {
		fleet.deactivate();
	});
}

function restoreOrchestrationMode(ctx: ExtensionContext): {
	enabled: boolean;
	recorded: boolean;
} {
	let enabled = false;
	let recorded = false;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (
			(entry.type !== "custom" && entry.type !== "custom_message") ||
			entry.customType !== ORCHESTRATION_STATE_TYPE
		)
			continue;
		const state =
			entry.type === "custom"
				? entry.data
				: entry.type === "custom_message"
					? entry.details
					: undefined;
		if (
			typeof state === "object" &&
			state !== null &&
			"enabled" in state &&
			typeof state.enabled === "boolean"
		) {
			enabled = state.enabled;
			recorded = true;
		}
	}
	return { enabled, recorded };
}

async function showHerdrMenu(
	fleet: AgentFleet,
	ctx: ExtensionContext,
	setActive: (active: boolean) => void,
): Promise<void> {
	const config = await readMachinesConfig().catch((error) => {
		ctx.ui.notify(
			`Shepherdr machine config is invalid: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return undefined;
	});
	if (!config) return;
	const statuses = fleet.isActive()
		? fleet.statuses()
		: Object.keys(config.machines).map((name) => ({
				local: false,
				name,
				status: "unavailable" as const,
			}));
	const selected = await ctx.ui.select("Shepherdr", [
		...(fleet.isActive() ? [] : ["Enable master for this session"]),
		"Enable master in this folder",
		"Add machine",
		...statuses
			.filter((machine) => !machine.local)
			.map(
				(machine) =>
					`${machine.status === "connected" ? "●" : machine.status === "connecting" ? "◌" : "○"} ${machine.name} · ${machine.status}`,
			),
	]);
	if (!selected) return;
	if (selected === "Enable master for this session") {
		if (await activateMaster(fleet, ctx, setActive))
			ctx.ui.notify("Herdr master enabled for this Pi session", "info");
		return;
	}
	if (selected === "Enable master in this folder") {
		if (!fleet.isActive() && !(await activateMaster(fleet, ctx, setActive)))
			return;
		try {
			const path = await enableMasterDirectory(ctx.cwd);
			ctx.ui.notify(`Herdr master enabled in ${path}`, "info");
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
		return;
	}
	if (selected === "Add machine") {
		await addMachine(ctx, fleet);
		return;
	}
	const name = selected.slice(2).split(" · ", 1)[0];
	if (!name) return;
	const status = statuses.find((machine) => machine.name === name);
	const action = await ctx.ui.select(name, [
		...(status?.status !== "connected" ? ["Connect"] : []),
		"Remove",
	]);
	if (action === "Connect") {
		if (!fleet.isActive() && !(await activateMaster(fleet, ctx, setActive)))
			return;
		ctx.ui.notify(fleet.connect(name), "info");
	} else if (action === "Remove") {
		const confirmed = await ctx.ui.confirm(
			`Remove ${name}?`,
			"The remote Shepherdr helper will remain available for other controllers",
		);
		if (!confirmed) return;
		delete config.machines[name];
		await writeMachinesConfig(config);
		await fleet.reload();
		ctx.ui.notify(`Removed ${name}`, "info");
	}
}

async function addMachine(
	ctx: ExtensionContext,
	fleet: AgentFleet,
): Promise<void> {
	const name = (await ctx.ui.input("Machine name", "desktop"))?.trim();
	if (!name) return;
	if (!isMachineName(name)) {
		ctx.ui.notify("Machine name must match [a-z][a-z0-9_-]{0,31}", "error");
		return;
	}
	const ssh = (
		await ctx.ui.input("SSH options and target (target last)", name)
	)?.trim();
	if (!ssh) return;
	let sshArguments: string[];
	try {
		sshArguments = parseSshArguments(ssh);
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
		return;
	}
	const session = (
		await ctx.ui.input("Herdr session", "default (leave blank)")
	)?.trim();
	const config = await readMachinesConfig();
	if (name === LOCAL_MACHINE || Object.hasOwn(config.machines, name)) {
		ctx.ui.notify(`Machine ${name} already exists`, "error");
		return;
	}
	config.machines[name] = {
		command: ["ssh", "-o", "BatchMode=yes", ...sshArguments],
		herdr: "herdr",
		node: "node",
		...(session && session !== "default (leave blank)" ? { session } : {}),
	};
	const path = await writeMachinesConfig(config);
	await fleet.reload();
	ctx.ui.notify(
		`Added ${name} in ${path}; Shepherdr manages ~/.pi/agent/shepherdr.mjs remotely`,
		"info",
	);
}

async function activateMaster(
	fleet: AgentFleet,
	ctx: ExtensionContext,
	setActive: (active: boolean) => void,
): Promise<boolean> {
	if (process.env["HERDR_ENV"] !== "1" || !process.env["HERDR_SOCKET_PATH"]) {
		setActive(false);
		ctx.ui.notify("Herdr master mode requires Pi to run inside Herdr", "error");
		return false;
	}
	try {
		setActive(true);
		await fleet.activate(ctx);
		setActive(true);
		return true;
	} catch (error) {
		fleet.deactivate();
		setActive(false);
		ctx.ui.notify(
			`Herdr master could not start: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return false;
	}
}

function setToolActive(
	pi: ExtensionAPI,
	toolName: string,
	active: boolean,
): void {
	const current = pi.getActiveTools();
	const withoutTool = current.filter((name) => name !== toolName);
	const next = active ? [...withoutTool, toolName] : withoutTool;
	if (
		next.length !== current.length ||
		next.some((name, index) => name !== current[index])
	) {
		pi.setActiveTools(next);
	}
}
