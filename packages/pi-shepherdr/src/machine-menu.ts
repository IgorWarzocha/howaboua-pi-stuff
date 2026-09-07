import { spawn } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentFleet } from "./fleet.js";
import { herdrBinary, readMachineCatalog } from "./machine-catalog.js";

async function runMachineCommand(
	ctx: ExtensionContext,
	args: string[],
): Promise<void> {
	if (ctx.mode !== "tui")
		throw new Error("Herdr machine setup requires an interactive Pi terminal");
	const result = await ctx.ui.custom<{ code: number | null; error?: string }>(
		(tui, _theme, _keys, done) => {
			tui.stop();
			process.stdout.write("\x1b[2J\x1b[H");
			let finished = false;
			const finish = (code: number | null, error?: string) => {
				if (finished) return;
				finished = true;
				tui.start();
				tui.requestRender(true);
				done({ code, ...(error ? { error } : {}) });
			};
			try {
				const child = spawn(herdrBinary(), ["machine", ...args], {
					stdio: "inherit",
				});
				child.once("error", (error) => finish(null, error.message));
				child.once("close", (code) => finish(code));
				return {
					render: () => [],
					invalidate: () => {},
					dispose: () => {
						if (!finished) child.kill();
					},
				};
			} catch (error) {
				finish(null, error instanceof Error ? error.message : String(error));
				return { render: () => [], invalidate: () => {} };
			}
		},
	);
	if (result.code !== 0)
		throw new Error(
			result.error ??
				`Herdr machine command exited ${result.code ?? "by signal"}; profile setup was not completed`,
		);
}

export async function showMachineMenu(
	fleet: AgentFleet,
	ctx: ExtensionContext,
): Promise<void> {
	try {
		const catalog = await readMachineCatalog();
		await fleet.reload();
		const statuses = new Map(
			fleet.statuses().map((machine) => [machine.id, machine]),
		);
		const choices = Object.values(catalog).map((machine) => ({
			machine,
			label: `${machine.label} · ${machine.target} · ${machine.session} · ${machine.enabled ? (statuses.get(machine.id)?.status ?? "unavailable") : "disabled"} [${machine.id}]`,
		}));
		const selected = await ctx.ui.select("Herdr machines", [
			"Add machine",
			...choices.map((choice) => choice.label),
		]);
		if (!selected) return;
		if (selected === "Add machine") {
			const target = (
				await ctx.ui.input("SSH target", "SSH alias or ssh://user@host:port")
			)?.trim();
			if (!target) return;
			const label = (await ctx.ui.input("Machine label", target))?.trim();
			if (!label) return;
			const session = (await ctx.ui.input("Herdr session", "default"))?.trim();
			if (session === undefined) return;
			await runMachineCommand(ctx, [
				"add",
				target,
				"--label",
				label,
				"--remote-session",
				session || "default",
			]);
		} else {
			const machine = choices.find(
				(choice) => choice.label === selected,
			)?.machine;
			if (!machine) return;
			const action = await ctx.ui.select(machine.label, [
				...(machine.enabled ? ["Connect", "Disable"] : ["Enable"]),
				"Rename",
				"Remove",
			]);
			if (!action) return;
			if (action === "Connect") {
				ctx.ui.notify(fleet.connect(machine.id), "info");
				return;
			}
			if (action === "Rename") {
				const label = (
					await ctx.ui.input("Machine label", machine.label)
				)?.trim();
				if (!label) return;
				await runMachineCommand(ctx, ["rename", machine.id, "--label", label]);
			} else {
				if (
					action === "Remove" &&
					!(await ctx.ui.confirm(
						`Remove ${machine.label}?`,
						"Removes the Herdr profile for every local client. Remote agents keep running.",
					))
				)
					return;
				await runMachineCommand(ctx, [action.toLowerCase(), machine.id]);
			}
		}
		await fleet.reload();
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
	}
}
