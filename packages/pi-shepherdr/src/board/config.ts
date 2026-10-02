import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const CONFIG_FILE = "pi-shepherdr.json";
export type BoardScope = "session" | "folder" | "global";

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDocument(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!object(value)) throw new Error("configuration must be an object");
		if (value["board"] !== undefined && !object(value["board"]))
			throw new Error("board must be an object");
		return value;
	} catch (error) {
		throw new Error(`Could not read ${path}: ${String(error)}`, {
			cause: error,
		});
	}
}

function readEnabled(path: string, scope: "folder" | "global") {
	const document = readDocument(path);
	const board = object(document["board"]) ? document["board"] : {};
	const field = scope === "global" ? "enabledGlobally" : "enabled";
	const wrongField = scope === "global" ? "enabled" : "enabledGlobally";
	if (wrongField in board)
		throw new Error(`${path}: use board.${field} for ${scope} enablement`);
	const value = board[field];
	if (value !== undefined && typeof value !== "boolean")
		throw new Error(`${path}: board.${field} must be a boolean`);
	return value;
}

function boardConfigPaths(folder: string) {
	return {
		global: resolve(getAgentDir(), CONFIG_FILE),
		folder: resolve(folder, ".pi", CONFIG_FILE),
	};
}

export function ensureBoardConfig() {
	const path = resolve(getAgentDir(), CONFIG_FILE);
	mkdirSync(dirname(path), { recursive: true });
	try {
		writeFileSync(
			path,
			`${JSON.stringify({ board: { enabledGlobally: false } }, null, 2)}\n`,
			{
				flag: "wx",
				mode: 0o600,
			},
		);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
			throw error;
	}
}

export function readBoardConfig(folder: string) {
	const paths = boardConfigPaths(folder);
	return {
		paths,
		folder: readEnabled(paths.folder, "folder"),
		global: readEnabled(paths.global, "global") ?? false,
	};
}

export function writeBoardConfig(
	folder: string,
	scope: "folder" | "global",
	enabled: boolean | undefined,
) {
	if (scope === "global" && enabled === undefined)
		throw new Error("Global enablement must be on or off");
	const path = boardConfigPaths(folder)[scope];
	readEnabled(path, scope);
	const document = readDocument(path);
	const board = object(document["board"]) ? { ...document["board"] } : {};
	const field = scope === "global" ? "enabledGlobally" : "enabled";
	if (enabled === undefined) delete board[field];
	else board[field] = enabled;
	if (enabled === undefined && !existsSync(path)) return;
	document["board"] = board;
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, {
			mode: 0o600,
		});
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}
