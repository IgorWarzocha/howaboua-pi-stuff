import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	COMMS_SETTINGS_FILE,
	isSettingsObject as object,
	readSettingsFile,
	settingsPath,
	writeSettingsFile as writeDocument,
} from "../settings-file.js";

const LEGACY_CONFIG_FILE = "pi-shepherdr.json";
export type BoardScope = "session" | "folder" | "global";

function readDocument(path: string): Record<string, unknown> {
	const value = readSettingsFile(path) ?? {};
	if (value["board"] !== undefined && !object(value["board"]))
		throw new Error(`${path}: board must be an object`);
	return value;
}

function readEnabled(
	path: string,
	scope: "folder" | "global",
	document = readDocument(path),
) {
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

function boardConfigPaths(folder: string, filename = COMMS_SETTINGS_FILE) {
	const global = settingsPath(getAgentDir(), filename);
	const local = settingsPath(resolve(folder, ".pi"), filename);
	return {
		global,
		// The global config is never also a folder config.
		folder: local === global ? undefined : local,
	};
}

export function migrateBoardSettings(folder: string, trusted: boolean): void {
	const paths = boardConfigPaths(folder);
	const legacy = boardConfigPaths(folder, LEGACY_CONFIG_FILE);
	for (const scope of ["global", "folder"] as const) {
		const path = paths[scope];
		const previousPath = legacy[scope];
		if (!path || (scope === "folder" && !trusted)) continue;
		const current = readDocument(path);
		const previous =
			previousPath && previousPath !== path ? readDocument(previousPath) : {};
		const oldBoard = previous["board"];
		if (
			!object(oldBoard) &&
			(scope !== "global" || current["board"] !== undefined)
		)
			continue;
		const newBoard = current["board"];
		const merged = {
			...(scope === "global" ? { enabledGlobally: object(oldBoard) } : {}),
			...(object(oldBoard) ? oldBoard : {}),
			...(object(newBoard) ? newBoard : {}),
		};
		const updated = { ...current, board: merged };
		readEnabled(path, scope, updated);
		writeDocument(path, updated);
		if (!previousPath || !object(oldBoard)) continue;
		delete previous["board"];
		if (Object.keys(previous).length) writeDocument(previousPath, previous);
		else rmSync(previousPath, { force: true });
	}
}

export function readBoardConfig(folder: string) {
	const paths = boardConfigPaths(folder);
	const legacy = boardConfigPaths(folder, LEGACY_CONFIG_FILE);
	const global = readEnabled(paths.global, "global");
	const folderSetting = paths.folder
		? readEnabled(paths.folder, "folder")
		: undefined;
	return {
		paths,
		folder:
			folderSetting ??
			(legacy.folder ? readEnabled(legacy.folder, "folder") : undefined),
		global: global ?? false,
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
