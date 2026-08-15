import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MACHINE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

export const LOCAL_MACHINE = "local";

export function isMachineName(value: string): boolean {
	return MACHINE_NAME.test(value);
}

export interface RemoteMachineConfig {
	command: string[];
	herdr: string;
	node: string;
	session?: string;
	socket?: string;
}

export interface MachinesConfig {
	machines: Record<string, RemoteMachineConfig>;
}

function agentDir(): string {
	return (
		process.env["PI_CODING_AGENT_DIR"]?.trim() ||
		join(homedir(), ".pi", "agent")
	);
}

function machinesConfigPath(): string {
	return join(agentDir(), "shepherdr.json");
}

function optionalString(
	value: Record<string, unknown>,
	key: string,
): string | undefined {
	const candidate = value[key];
	if (candidate === undefined) return undefined;
	if (typeof candidate !== "string" || !candidate.trim()) {
		throw new Error(`${key} must be a non-empty string`);
	}
	return candidate.trim();
}

function parseMachine(name: string, value: unknown): RemoteMachineConfig {
	if (!isMachineName(name)) {
		throw new Error(
			`machine name ${JSON.stringify(name)} must match ${MACHINE_NAME.source}`,
		);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`machine ${JSON.stringify(name)} must be an object`);
	}
	const record = value as Record<string, unknown>;
	const command = record["command"];
	if (
		!Array.isArray(command) ||
		command.length === 0 ||
		command.some((part) => typeof part !== "string" || !part)
	) {
		throw new Error(
			`machine ${JSON.stringify(name)} command must be a non-empty string array`,
		);
	}
	const session = optionalString(record, "session");
	const socket = optionalString(record, "socket");
	if (session && socket) {
		throw new Error(
			`machine ${JSON.stringify(name)} cannot set both session and socket`,
		);
	}
	return {
		command: command as string[],
		herdr: optionalString(record, "herdr") ?? "herdr",
		node: optionalString(record, "node") ?? "node",
		...(session ? { session } : {}),
		...(socket ? { socket } : {}),
	};
}

export async function readMachinesConfig(): Promise<MachinesConfig> {
	const path = machinesConfigPath();
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { machines: {} };
		}
		throw new Error(
			`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(
			`could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	const record = value as Record<string, unknown>;
	const machines = record["machines"] ?? {};
	if (
		typeof machines !== "object" ||
		machines === null ||
		Array.isArray(machines)
	) {
		throw new Error(`${path} machines must be an object`);
	}
	const parsed = Object.fromEntries(
		Object.entries(machines).map(([name, machine]) => [
			name,
			parseMachine(name, machine),
		]),
	);
	if (LOCAL_MACHINE in parsed)
		throw new Error(
			`remote machine ${JSON.stringify(LOCAL_MACHINE)} conflicts with local`,
		);
	return { machines: parsed };
}

export async function writeMachinesConfig(
	config: MachinesConfig,
): Promise<string> {
	const path = machinesConfigPath();
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		await rename(temporaryPath, path);
	} catch (error) {
		await unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
	return path;
}
