import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CoreClient } from "./client.js";
import { object } from "./protocol.js";

const exec = promisify(execFile);
const delay = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function appSocket(): string {
	return join(
		process.env["HERDR_APP_HOME"] ||
			join(
				process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config"),
				"herdr-app",
			),
		"herdr-app.sock",
	);
}

async function app(args: string[]): Promise<Record<string, unknown>> {
	try {
		const { stdout } = await exec("herdr-app", args, {
			timeout: 7_000,
			maxBuffer: 1024 * 1024,
		});
		const result = object(JSON.parse(stdout));
		if (typeof result["error"] === "string") throw new Error(result["error"]);
		return result;
	} catch (error) {
		throw new Error(
			`Herdr window did not respond: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
}

function panes(
	world: Record<string, unknown>,
): Array<{ space: string; tab: string; terminal: string; name: string }> {
	if (!Array.isArray(world["spaces"]))
		throw new Error("Herdr window returned an invalid workspace list");
	const result: Array<{
		space: string;
		tab: string;
		terminal: string;
		name: string;
	}> = [];
	for (const space of world["spaces"]) {
		const s = object(space);
		if (typeof s["id"] !== "string" || !Array.isArray(s["tabs"]))
			throw new Error("Herdr window returned an invalid workspace");
		for (const tab of s["tabs"]) {
			const t = object(tab);
			if (typeof t["id"] !== "string" || !Array.isArray(t["terminals"]))
				throw new Error("Herdr window returned an invalid tab");
			for (const value of t["terminals"]) {
				const terminal = object(value);
				if (typeof terminal["terminal"] === "string")
					result.push({
						space: s["id"],
						tab: t["id"],
						terminal: terminal["terminal"],
						name: typeof terminal["name"] === "string" ? terminal["name"] : "",
					});
			}
		}
	}
	return result;
}

/** Verify the selected window sees this Core before acting on its local terminal IDs. */
export async function focusCoreWindow(
	core: CoreClient,
	target: string,
): Promise<void> {
	if (!/^t[0-9a-z]+$/.test(target))
		throw new Error("Use the exact local terminal address");
	const socket = appSocket();
	const original = await stat(socket).catch(() => {
		throw new Error("Open the Herdr window on this machine and retry focus");
	});
	const token = randomBytes(12).toString("hex");
	const name = `probe-${token}`;
	const space = `sp${token}`;
	const tab = `tb${token}`;
	let probe: string | undefined;
	let focused = false;
	let failed = false;
	let failure: unknown;
	try {
		const created = object(
			await core.request("terminal.run", {
				argv: [process.execPath, "-e", "setTimeout(()=>{},120000)"],
				name,
				labels: { "herdr.space": space, "herdr.tab": tab },
				no_parent: true,
				no_notify: true,
				rm: true,
			}),
		);
		if (
			typeof created["address"] !== "string" ||
			!/^t[0-9a-z]+$/.test(created["address"])
		)
			throw new Error(
				"Core did not return a probe terminal; inspect its terminals before retrying",
			);
		probe = created["address"];
		const deadline = Date.now() + 8_000;
		let world: ReturnType<typeof panes> = [];
		while (Date.now() < deadline) {
			world = panes(await app(["ls"]));
			if (
				world.some(
					(entry) =>
						entry.space === space &&
						entry.tab === tab &&
						entry.terminal === probe &&
						entry.name === name,
				)
			)
				break;
			await delay(100);
		}
		if (
			!world.some(
				(entry) =>
					entry.space === space &&
					entry.tab === tab &&
					entry.terminal === probe &&
					entry.name === name,
			)
		)
			throw new Error(
				"This Herdr window is not connected to the target Core; open its window and retry",
			);
		const checkWindow = async () => {
			const current = await stat(socket);
			if (current.dev !== original.dev || current.ino !== original.ino)
				throw new Error(
					"Herdr window changed during focus; inspect it before retrying",
				);
		};
		await checkWindow();
		if (!world.some((entry) => entry.terminal === target)) {
			await app(["do", "space.select", JSON.stringify({ id: space })]);
			await checkWindow();
			await app(["do", "terminal.keep", JSON.stringify({ terminal: target })]);
			const adoptionDeadline = Date.now() + 8_000;
			while (Date.now() < adoptionDeadline) {
				world = panes(await app(["ls"]));
				if (world.some((entry) => entry.terminal === target)) break;
				await delay(100);
			}
			if (!world.some((entry) => entry.terminal === target))
				throw new Error(
					"Herdr did not finish opening the target; inspect its window before retrying",
				);
		}
		await checkWindow();
		await app(["do", "pane.focus", JSON.stringify({ terminal: target })]);
		focused = true;
	} catch (error) {
		failed = true;
		failure = error;
	} finally {
		if (probe) {
			try {
				await core.request("terminal.kill", { terminal: probe });
			} catch (error) {
				if (
					error instanceof Error &&
					"kind" in error &&
					error.kind === "not_found"
				) {
					if (failed) throw failure;
					return;
				}
				throw new Error(
					`${focused ? "Focus succeeded" : `Focus failed: ${String(failure)}`} but its temporary terminal could not be closed: ${String(error)}`,
					{ cause: failure ?? error },
				);
			}
		}
	}
	if (failed) throw failure;
}
