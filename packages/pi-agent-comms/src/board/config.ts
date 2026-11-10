import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
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
	// Keep aliases on one write target so atomic saves do not replace symlinks.
	function configPath(directory: string) {
		const path = resolve(directory, CONFIG_FILE);
		return existsSync(path) ? realpathSync(path) : path;
	}
	const global = configPath(getAgentDir());
	const local = configPath(resolve(folder, ".pi"));
	return {
		global,
		// The global config is never also a folder config.
		folder: local === global ? undefined : local,
	};
}

export function readBoardConfig(folder: string, defaultEnabled = false) {
	const paths = boardConfigPaths(folder);
	const global = readEnabled(paths.global, "global");
	return {
		paths,
		folder: paths.folder ? readEnabled(paths.folder, "folder") : undefined,
		global: global ?? defaultEnabled,
	};
}

export function writeBoardConfig(
	folder: string,
	scope: "folder" | "global",
	enabled: boolean,
) {
	const path = boardConfigPaths(folder)[scope];
	if (!path)
		throw new Error(
			"This folder's config is the global config; use a session override instead",
		);
	readEnabled(path, scope);
	const document = readDocument(path);
	const board = object(document["board"]) ? { ...document["board"] } : {};
	const field = scope === "global" ? "enabledGlobally" : "enabled";
	board[field] = enabled;
	document["board"] = board;
	writeDocument(path, document);
}

function writeDocument(path: string, document: Record<string, unknown>) {
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

export type BoardSummarySelection = "luna" | "custom";
export type BoardSummaryModel = {
	provider: string;
	model: string;
	reasoning: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
};

const LUNA_SUMMARY_MODEL: BoardSummaryModel = {
	provider: "openai-codex",
	model: "gpt-6-luna",
	reasoning: "high",
};

export function readBoardSummaryConfig(folder: string) {
	const path = boardConfigPaths(folder).global;
	const document = readDocument(path);
	const board = object(document["board"]) ? document["board"] : {};
	const summary = board["summary"];
	if (summary !== undefined && !object(summary))
		throw new Error(`${path}: board.summary must be an object`);
	const automatic = summary?.["automatic"] ?? false;
	if (typeof automatic !== "boolean")
		throw new Error(`${path}: board.summary.automatic must be true or false`);
	const selection = summary?.["selection"] ?? "luna";
	if (selection !== "luna" && selection !== "custom")
		throw new Error(`${path}: board.summary.selection must be luna or custom`);
	return { path, automatic, selection, custom: summary?.["custom"] };
}

function customSummaryModel(value: unknown, path: string): BoardSummaryModel {
	const instruction = `Edit board.summary.custom in ${path}: set provider, model and reasoning (off|minimal|low|medium|high|xhigh|max)`;
	if (!object(value)) throw new Error(instruction);
	const { provider, model, reasoning } = value;
	if (
		typeof provider !== "string" ||
		!provider.trim() ||
		typeof model !== "string" ||
		!model.trim() ||
		(reasoning !== "off" &&
			reasoning !== "minimal" &&
			reasoning !== "low" &&
			reasoning !== "medium" &&
			reasoning !== "high" &&
			reasoning !== "xhigh" &&
			reasoning !== "max")
	)
		throw new Error(instruction);
	return { provider, model, reasoning };
}

export function resolveBoardSummaryModel(folder: string): BoardSummaryModel {
	const config = readBoardSummaryConfig(folder);
	return config.selection === "luna"
		? { ...LUNA_SUMMARY_MODEL }
		: customSummaryModel(config.custom, config.path);
}

export function writeBoardSummarySelection(
	folder: string,
	selection: BoardSummarySelection,
) {
	const config = readBoardSummaryConfig(folder);
	const document = readDocument(config.path);
	const board = object(document["board"]) ? { ...document["board"] } : {};
	const summary = object(board["summary"]) ? { ...board["summary"] } : {};
	summary["luna"] = {
		...(object(summary["luna"]) ? summary["luna"] : {}),
		...LUNA_SUMMARY_MODEL,
	};
	if (summary["custom"] === undefined)
		summary["custom"] = { provider: "", model: "", reasoning: "high" };
	summary["selection"] = selection;
	board["summary"] = summary;
	document["board"] = board;
	writeDocument(config.path, document);
}

export function writeBoardSummaryAutomatic(folder: string, automatic: boolean) {
	const config = readBoardSummaryConfig(folder);
	const document = readDocument(config.path);
	const board = object(document["board"]) ? { ...document["board"] } : {};
	const summary = object(board["summary"]) ? { ...board["summary"] } : {};
	summary["automatic"] = automatic;
	board["summary"] = summary;
	document["board"] = board;
	writeDocument(config.path, document);
}
