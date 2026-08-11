import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { getSnapshot, resolveWorkspace } from "./herdr.js";
import type { HerdrClient } from "./herdr-client.js";
import type { AgentMonitor } from "./monitor.js";
import type { PaneInfo } from "./types.js";

export const START_PLACEMENTS = ["new_workspace", "new_tab", "pane"] as const;
const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

export interface StartAgentParams {
	cwd?: string;
	label?: string;
	name?: string;
	pane?: string;
	placement?: (typeof START_PLACEMENTS)[number];
	prompt?: string;
	workspace?: string;
}

function required(value: string | undefined, field: string): string {
	if (!value?.trim()) throw new Error(`${field} is required for start`);
	return value.trim();
}

async function directory(
	value: string | undefined,
	fallback: string,
): Promise<string> {
	const path = resolve(fallback, value?.trim() || ".");
	const metadata = await stat(path).catch((error) => {
		throw new Error(
			`cannot use working directory ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	if (!metadata.isDirectory())
		throw new Error(`${JSON.stringify(path)} is not a directory`);
	return path;
}

async function createStartPane(
	client: HerdrClient,
	params: StartAgentParams,
	cwd: string,
	label: string,
): Promise<{
	cleanup?: { id: string; method: "tab.close" | "workspace.close" };
	paneId: string;
}> {
	const placement = params.placement;
	if (!placement) throw new Error("placement is required for start");
	if (placement === "pane") {
		return { paneId: required(params.pane, "pane") };
	}
	if (placement === "new_tab") {
		const workspaceTarget = required(params.workspace, "workspace");
		const workspace = resolveWorkspace(
			await getSnapshot(client),
			workspaceTarget,
		);
		const created = await client.request<{
			root_pane: PaneInfo;
			tab: { tab_id: string };
		}>("tab.create", {
			workspace_id: workspace.workspace_id,
			cwd,
			label,
			focus: false,
		});
		return {
			paneId: created.root_pane.pane_id,
			cleanup: { method: "tab.close", id: created.tab.tab_id },
		};
	}
	const created = await client.request<{
		root_pane: PaneInfo;
		tab: { tab_id: string };
		workspace: { workspace_id: string };
	}>("workspace.create", { cwd, focus: false });
	try {
		await client.request("tab.rename", { tab_id: created.tab.tab_id, label });
	} catch (error) {
		await client.request("workspace.close", {
			workspace_id: created.workspace.workspace_id,
		});
		throw error;
	}
	return {
		paneId: created.root_pane.pane_id,
		cleanup: { method: "workspace.close", id: created.workspace.workspace_id },
	};
}

export async function startAgent(
	client: HerdrClient,
	monitor: AgentMonitor,
	params: StartAgentParams,
	fallbackCwd: string,
): Promise<Record<string, unknown>> {
	const name = required(params.name, "name");
	if (!AGENT_NAME.test(name)) {
		throw new Error("name must match [a-z][a-z0-9_-]{0,31}");
	}
	const label = params.label?.trim() || name;
	if (params.placement === "pane" && params.cwd) {
		throw new Error(
			"cwd cannot change an existing pane; prepare the pane through Herdr",
		);
	}
	const cwd =
		params.placement === "pane"
			? fallbackCwd
			: await directory(params.cwd, fallbackCwd);
	const created = await createStartPane(client, params, cwd, label);
	let agent: PaneInfo;
	try {
		agent = await startWhenShellReady(client, {
			name,
			kind: "pi",
			pane_id: created.paneId,
			args: ["--name", label],
			timeout_ms: 30_000,
		});
	} catch (error) {
		if (created.cleanup) {
			await client
				.request(created.cleanup.method, {
					[created.cleanup.method === "tab.close" ? "tab_id" : "workspace_id"]:
						created.cleanup.id,
				})
				.catch(() => undefined);
		}
		throw error;
	}
	await monitor.watch(agent);
	if (params.prompt?.trim()) {
		const prompt = params.prompt.trim();
		monitor.beginWork(agent.pane_id, prompt);
		try {
			await client.request("agent.prompt", {
				target: agent.pane_id,
				text: prompt,
			});
		} catch (error) {
			await monitor.reconcileNow().catch(() => undefined);
			throw error;
		}
	}
	return {
		started: true,
		id: agent.pane_id,
		name,
		cwd: agent.foreground_cwd ?? agent.cwd ?? cwd,
		workspaceId: agent.workspace_id,
		tabId: agent.tab_id,
		monitored: true,
	};
}

async function startWhenShellReady(
	client: HerdrClient,
	params: Record<string, unknown>,
): Promise<PaneInfo> {
	const shellDeadline = Date.now() + 3_000;
	let started: { agent: PaneInfo };
	for (;;) {
		try {
			started = await client.request<{ agent: PaneInfo }>(
				"agent.start",
				params,
				35_000,
			);
			break;
		} catch (error) {
			if (
				(error as Error & { code?: string }).code !== "agent_pane_busy" ||
				Date.now() >= shellDeadline
			) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	const name = required(
		typeof params["name"] === "string" ? params["name"] : undefined,
		"name",
	);
	const paneId = required(
		typeof params["pane_id"] === "string" ? params["pane_id"] : undefined,
		"pane_id",
	);
	const terminalId = started.agent.terminal_id;
	const readyDeadline = Date.now() + 30_000;
	while (Date.now() < readyDeadline) {
		let current: PaneInfo;
		try {
			current = await resolveDuringStart(client, name, paneId);
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
			continue;
		}
		if (current.terminal_id !== terminalId || current.name !== name) {
			throw new Error(`named agent ${name} no longer owns ${paneId}`);
		}
		if (current.agent && current.agent !== "pi") {
			throw new Error(`expected pi, detected ${current.agent}`);
		}
		if (current.agent_status === "blocked") {
			throw new Error(`agent ${name} is blocked during startup`);
		}
		if (
			(current.agent_status === "idle" || current.agent_status === "done") &&
			current.interactive_ready === true &&
			current.agent === "pi"
		) {
			return current;
		}
		if (
			(current.agent_status === "idle" || current.agent_status === "done") &&
			current.launch_pending === false
		) {
			throw new Error("agent process exited before becoming interactive");
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`timed out waiting for agent ${name} to become interactive`);
}

async function resolveDuringStart(
	client: HerdrClient,
	name: string,
	paneId: string,
): Promise<PaneInfo> {
	try {
		return (
			await client.request<{ agent: PaneInfo }>("agent.get", { target: name })
		).agent;
	} catch {
		return (
			await client.request<{ agent: PaneInfo }>("agent.get", { target: paneId })
		).agent;
	}
}
