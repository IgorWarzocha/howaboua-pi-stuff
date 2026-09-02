import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentFleet } from "./fleet.js";
import {
	isMachineName,
	LOCAL_MACHINE,
	readMachinesConfig,
	writeMachinesConfig,
} from "./machines-config.js";

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

export async function showMachineMenu(
	fleet: AgentFleet,
	ctx: ExtensionContext,
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
	const selected = await ctx.ui.select("Shepherdr machines", [
		"Add machine",
		...statuses
			.filter((machine) => !machine.local)
			.map(
				(machine) =>
					`${machine.status === "connected" ? "●" : machine.status === "connecting" ? "◌" : "○"} ${machine.name} · ${machine.status}`,
			),
	]);
	if (!selected) return;
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
		if (!fleet.isActive()) {
			ctx.ui.notify("Run /herdr to activate agents first", "warning");
			return;
		}
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
