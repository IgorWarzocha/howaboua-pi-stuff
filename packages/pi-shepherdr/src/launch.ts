import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "@earendil-works/pi-coding-agent";
import { CoreConnection } from "./core/backend.js";
import { startCoreAgent } from "./core/spawn.js";
import { getAgent, getPane, parsePaneInfo, sessionPath } from "./herdr.js";
import { type HerdrConnection, isHerdrErrorCode } from "./herdr-client.js";
import {
	requiredStartField,
	type StartAgentParams,
	type StartedAgent,
	UnstartedAgentLaunchError,
} from "./launch-contract.js";
import { createStartPane, rollbackCreatedLocation } from "./launch-location.js";
import type { PaneInfo } from "./types.js";
import { WORKER_FLAG } from "./worker-role.js";

export {
	RolledBackAgentLaunchError,
	START_PLACEMENTS,
	UnstartedAgentLaunchError,
} from "./launch-contract.js";

const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

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
	if (client instanceof CoreConnection && params.placement === "pane")
		throw new UnstartedAgentLaunchError(
			"Core cannot start Pi in an existing terminal without terminal input; use terminal, new_tab or new_workspace placement",
		);
	if (params.placement !== "pane") {
		return resolveStartDirectory(params, fallbackCwd, resolveDirectory);
	}
	const pane = await getPane(client, requiredStartField(params.pane, "pane"));
	return pane.foreground_cwd?.trim() || pane.cwd?.trim() || fallbackCwd;
}

interface StartAgentOptions {
	agentArgs?: string[];
}

export async function startAgent(
	client: HerdrConnection,
	params: StartAgentParams,
	fallbackCwd: string,
	resolveDirectory: DirectoryResolver = directory,
	options: StartAgentOptions = {},
): Promise<StartedAgent> {
	const name = requiredStartField(params.name, "name");
	if (!AGENT_NAME.test(name)) {
		throw new Error(
			"name must be 1–32 characters, start with a lowercase letter, and contain only lowercase letters, digits, underscores or hyphens. Omit name to generate it from label; label can be longer.",
		);
	}
	const label = params.label?.trim() || name;
	const args = [
		`--${WORKER_FLAG}`,
		"--name",
		label,
		...(options.agentArgs ?? []),
	];
	const parsed = parseArgs(args);
	if (parsed.unknownFlags.get(WORKER_FLAG) !== true) {
		throw new Error(
			"spawn requires its worker role; remove --shepherdr-worker from profile pi_args",
		);
	}
	if (parsed.noSession) {
		throw new Error(
			"spawn requires a persistent Pi session; remove --no-session from profile pi_args",
		);
	}
	if (params.placement === "pane" && params.cwd) {
		throw new Error(
			"cwd cannot change an existing pane; prepare the pane through Herdr",
		);
	}
	if (client instanceof CoreConnection && params.placement === "pane")
		throw new UnstartedAgentLaunchError(
			"Core cannot start Pi in an existing terminal without terminal input; use terminal, new_tab or new_workspace placement",
		);
	let cwd: string;
	try {
		cwd = await resolveStartDirectory(params, fallbackCwd, resolveDirectory);
	} catch (error) {
		throw new UnstartedAgentLaunchError(error);
	}
	if (client instanceof CoreConnection)
		return startCoreAgent(client, params, cwd, label, args);
	const created = await createStartPane(client, params, cwd, label);
	let agent: PaneInfo;
	try {
		agent = await startWhenShellReady(client, {
			name,
			kind: "pi",
			pane_id: created.paneId,
			args,
			timeout_ms: 30_000,
		});
	} catch (error) {
		return rollbackCreatedLocation(client, created.cleanup, error);
	}
	return {
		agent,
		...(created.cleanup ? { cleanup: created.cleanup } : {}),
		id: agent.pane_id,
	};
}

export async function rollbackStartedAgent(
	client: HerdrConnection,
	started: StartedAgent,
	cause: unknown,
): Promise<never> {
	return rollbackCreatedLocation(client, started.cleanup, cause);
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

	const name = requiredStartField(
		typeof params["name"] === "string" ? params["name"] : undefined,
		"name",
	);
	const paneId = requiredStartField(
		typeof params["pane_id"] === "string" ? params["pane_id"] : undefined,
		"pane_id",
	);
	const terminalId = started.agent.terminal_id;
	const readyDeadline = Date.now() + 30_000;
	let waitingForSession = false;
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
		waitingForSession =
			(current.agent_status === "idle" || current.agent_status === "done") &&
			current.interactive_ready === true &&
			current.agent === "pi";
		if (waitingForSession) {
			if (sessionPath(current)) return current;
			// Herdr can finish launch before Pi reports its persistent session.
		} else if (
			(current.agent_status === "idle" || current.agent_status === "done") &&
			current.launch_pending === false
		) {
			throw new Error("agent process exited before becoming interactive");
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`timed out waiting for agent ${name} ${waitingForSession ? "to register its Pi session" : "to become interactive"}`,
	);
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
