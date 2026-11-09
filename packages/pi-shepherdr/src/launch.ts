import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "@earendil-works/pi-coding-agent";
import {
	ANCESTRY_FLAG,
	parseSpawnAncestry,
	type SpawnAncestry,
} from "./ancestry-record.js";
import type { CoreConnection } from "./core/backend.js";
import { startCoreAgent } from "./core/spawn.js";
import {
	requiredStartField,
	type StartAgentParams,
	type StartedAgent,
	UnstartedAgentLaunchError,
} from "./launch-contract.js";
import { rollbackCreatedLocation } from "./launch-location.js";
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

export async function resolvePreparationDirectory(
	params: StartAgentParams,
	fallbackCwd: string,
	resolveDirectory: DirectoryResolver = directory,
): Promise<string> {
	return resolveDirectory(params.cwd, fallbackCwd);
}

export interface StartAgentOptions {
	agentArgs?: string[];
	signal?: AbortSignal;
	ancestry?: SpawnAncestry;
}

// Pi restores these from the session. Initial profile defaults must not reset them.
export function resumeAgentArgs(args: readonly string[]): string[] {
	const restored = new Set([
		"--model",
		"--provider",
		"--thinking",
		"--name",
		"-n",
	]);
	const result: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]!;
		if (restored.has(arg)) {
			index += 1;
			continue;
		}
		if ([...restored].some((flag) => arg.startsWith(`${flag}=`))) continue;
		result.push(arg);
	}
	return result;
}

export async function startAgent(
	client: CoreConnection,
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
	const resuming = options.agentArgs?.some((arg) =>
		/^--session(?:=|$)/.test(arg),
	);
	const args = [
		`--${WORKER_FLAG}`,
		...(resuming && !params.label?.trim() ? [] : ["--name", label]),
		...(options.agentArgs ?? []),
		...(options.ancestry
			? [
					`--${ANCESTRY_FLAG}`,
					JSON.stringify(parseSpawnAncestry(options.ancestry)),
				]
			: []),
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
	let cwd: string;
	try {
		cwd = await resolveDirectory(params.cwd, fallbackCwd);
	} catch (error) {
		throw new UnstartedAgentLaunchError(error);
	}
	let entered = false;
	try {
		return await client.admission.run(
			"launch",
			() => {
				entered = true;
				return startCoreAgent(client, params, cwd, args, options.signal);
			},
			options.signal,
		);
	} catch (error) {
		if (!entered) throw new UnstartedAgentLaunchError(error);
		throw error;
	}
}

export async function rollbackStartedAgent(
	client: CoreConnection,
	started: StartedAgent,
	cause: unknown,
): Promise<never> {
	return rollbackCreatedLocation(client, started.cleanup, cause);
}
