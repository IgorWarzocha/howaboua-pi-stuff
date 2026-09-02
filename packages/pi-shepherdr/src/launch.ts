import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
	getAgent,
	getPane,
	getSnapshot,
	parsePaneInfo,
	resolveWorkspace,
} from "./herdr.js";
import { type HerdrConnection, isHerdrErrorCode } from "./herdr-client.js";
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

export type DirectoryResolver = (
	value: string | undefined,
	fallback: string,
) => Promise<string>;

function resolveStartDirectory(
	params: StartAgentParams,
	fallbackCwd: string,
	resolveDirectory: DirectoryResolver = directory,
): Promise<string> {
	return params.placement === "pane"
		? Promise.resolve(fallbackCwd)
		: resolveDirectory(params.cwd, fallbackCwd);
}

export async function resolvePreparationDirectory(
	client: HerdrConnection,
	params: StartAgentParams,
	fallbackCwd: string,
	resolveDirectory: DirectoryResolver = directory,
): Promise<string> {
	if (params.placement !== "pane") {
		return resolveStartDirectory(params, fallbackCwd, resolveDirectory);
	}
	const pane = await getPane(client, required(params.pane, "pane"));
	return pane.foreground_cwd?.trim() || pane.cwd?.trim() || fallbackCwd;
}

interface StartAgentOptions {
	agentArgs?: string[];
}

interface CreatedLocationCleanup {
	id: string;
	method: "tab.close" | "workspace.close";
}

export interface StartedAgent {
	agent: PaneInfo;
	cleanup?: CreatedLocationCleanup;
	id: string;
}

async function createStartPane(
	client: HerdrConnection,
	params: StartAgentParams,
	cwd: string,
	label: string,
): Promise<{
	cleanup?: CreatedLocationCleanup;
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
		const created = createdLocation(
			await client.request<unknown>("tab.create", {
				workspace_id: workspace.workspace_id,
				cwd,
				label,
				focus: false,
			}),
			"tab.create result",
		);
		return {
			paneId: created.root_pane.pane_id,
			cleanup: { method: "tab.close", id: created.tab.tab_id },
		};
	}
	const created = createdLocation(
		await client.request<unknown>("workspace.create", {
			cwd,
			focus: false,
		}),
		"workspace.create result",
		true,
	);
	try {
		await client.request("tab.rename", { tab_id: created.tab.tab_id, label });
	} catch (error) {
		return rollbackCreatedLocation(
			client,
			{ method: "workspace.close", id: created.workspace.workspace_id },
			error,
		);
	}
	return {
		paneId: created.root_pane.pane_id,
		cleanup: { method: "workspace.close", id: created.workspace.workspace_id },
	};
}

function createdLocation(
	value: unknown,
	path: string,
): { root_pane: PaneInfo; tab: { tab_id: string } };
function createdLocation(
	value: unknown,
	path: string,
	withWorkspace: true,
): {
	root_pane: PaneInfo;
	tab: { tab_id: string };
	workspace: { workspace_id: string };
};
function createdLocation(
	value: unknown,
	path: string,
	withWorkspace = false,
): {
	root_pane: PaneInfo;
	tab: { tab_id: string };
	workspace?: { workspace_id: string };
} {
	if (typeof value !== "object" || value === null) {
		throw new Error(`Herdr ${path} must be an object`);
	}
	const result = value as Record<string, unknown>;
	const tabId = nestedId(result["tab"], "tab_id", `${path}.tab`);
	return {
		root_pane: parsePaneInfo(result["root_pane"], `${path}.root_pane`),
		tab: { tab_id: tabId },
		...(withWorkspace
			? {
					workspace: {
						workspace_id: nestedId(
							result["workspace"],
							"workspace_id",
							`${path}.workspace`,
						),
					},
				}
			: {}),
	};
}

function nestedId(value: unknown, key: string, path: string): string {
	if (typeof value !== "object" || value === null) {
		throw new Error(`Herdr ${path} must be an object`);
	}
	const id = (value as Record<string, unknown>)[key];
	if (typeof id !== "string")
		throw new Error(`Herdr ${path}.${key} must be string`);
	return id;
}

export async function startAgent(
	client: HerdrConnection,
	monitor: AgentMonitor,
	params: StartAgentParams,
	fallbackCwd: string,
	resolveDirectory: DirectoryResolver = directory,
	options: StartAgentOptions = {},
): Promise<StartedAgent> {
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
	const cwd = await resolveStartDirectory(
		params,
		fallbackCwd,
		resolveDirectory,
	);
	const created = await createStartPane(client, params, cwd, label);
	let agent: PaneInfo;
	try {
		agent = await startWhenShellReady(client, {
			name,
			kind: "pi",
			pane_id: created.paneId,
			args: ["--name", label, ...(options.agentArgs ?? [])],
			timeout_ms: 30_000,
		});
	} catch (error) {
		return rollbackCreatedLocation(client, created.cleanup, error);
	}
	try {
		await monitor.watch(agent);
	} catch (error) {
		return rollbackCreatedLocation(client, created.cleanup, error);
	}
	if (params.prompt?.trim()) {
		const prompt = params.prompt.trim();
		const attempt = monitor.beginWork(agent.pane_id, prompt);
		try {
			await client.request("agent.prompt", {
				target: agent.pane_id,
				text: prompt,
			});
			monitor.acceptWork(attempt);
		} catch (error) {
			await monitor.handleWorkFailure(attempt, error);
			throw error;
		}
	}
	return {
		agent,
		...(created.cleanup ? { cleanup: created.cleanup } : {}),
		id: agent.pane_id,
	};
}

export async function rollbackStartedAgent(
	client: HerdrConnection,
	monitor: AgentMonitor,
	started: StartedAgent,
	cause: unknown,
): Promise<never> {
	if (!started.cleanup) throw cause;
	await monitor.unwatch(started.id).catch(() => undefined);
	return rollbackCreatedLocation(client, started.cleanup, cause);
}

async function rollbackCreatedLocation(
	client: HerdrConnection,
	cleanup: CreatedLocationCleanup | undefined,
	cause: unknown,
): Promise<never> {
	if (!cleanup) throw cause;
	try {
		await client.request(cleanup.method, {
			[cleanup.method === "tab.close" ? "tab_id" : "workspace_id"]: cleanup.id,
		});
	} catch (cleanupError) {
		throw new Error(
			`${cause instanceof Error ? cause.message : String(cause)}; rollback also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
			{ cause },
		);
	}
	throw cause;
}

async function startWhenShellReady(
	client: HerdrConnection,
	params: Record<string, unknown>,
): Promise<PaneInfo> {
	const shellDeadline = Date.now() + 3_000;
	let started: { agent: PaneInfo };
	for (;;) {
		try {
			const result = await client.request<{ agent?: unknown }>(
				"agent.start",
				params,
				35_000,
			);
			started = {
				agent: parsePaneInfo(result.agent, "agent.start result.agent"),
			};
			break;
		} catch (error) {
			if (
				!isHerdrErrorCode(error, "agent_pane_busy") ||
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
		} catch (error) {
			if (!isHerdrErrorCode(error, "agent_not_found")) throw error;
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
	client: HerdrConnection,
	name: string,
	paneId: string,
): Promise<PaneInfo> {
	try {
		return await getAgent(client, name);
	} catch (error) {
		if (!isHerdrErrorCode(error, "agent_not_found")) throw error;
		return getAgent(client, paneId);
	}
}
