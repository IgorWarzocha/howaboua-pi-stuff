import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	resolve,
} from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parse } from "smol-toml";
import type { DynamicToolDefinition, DynamicToolInputMode } from "./types.js";

export const DYNAMIC_TOOLS_DIRNAME = "dynamic-tools";
const TOOL_NAME_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const NODE_SCRIPT_PATTERN = /\.(?:cjs|mjs|js)$/i;

export function getDynamicToolsDir(agentDir: string = getAgentDir()): string {
	return join(agentDir, DYNAMIC_TOOLS_DIRNAME);
}

function requiredString(value: unknown, field: string, path: string): string {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${path}: ${field} must be a non-empty string`);
	return value.trim();
}

function optionalString(
	value: unknown,
	field: string,
	path: string,
): string | undefined {
	if (value === undefined) return undefined;
	return requiredString(value, field, path);
}

function stringArray(value: unknown, field: string, path: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
		throw new Error(`${path}: ${field} must be an array of strings`);
	return [...value];
}

function inputMode(value: unknown, path: string): DynamicToolInputMode {
	if (value === undefined) return "arg";
	if (value === "arg" || value === "stdin") return value;
	throw new Error(`${path}: input must be "arg" or "stdin"`);
}

function deferLoading(value: unknown, path: string): boolean {
	if (value === undefined) return true;
	if (typeof value === "boolean") return value;
	throw new Error(`${path}: defer_loading must be a boolean`);
}

export function parseDynamicTool(
	path: string,
	text: string,
): DynamicToolDefinition {
	const name = basename(path, extname(path));
	if (!TOOL_NAME_PATTERN.test(name))
		throw new Error(
			`${path}: filename must be a JavaScript-compatible tool name`,
		);
	const value = parse(text) as Record<string, unknown>;
	const known = new Set([
		"description",
		"output",
		"defer_loading",
		"command",
		"args",
		"input",
	]);
	const unknown = Object.keys(value).filter((key) => !known.has(key));
	if (unknown.length > 0)
		throw new Error(
			`${path}: unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
		);
	const command = requiredString(value["command"], "command", path);
	const args = stringArray(value["args"], "args", path);
	const resolvedCommand = command.startsWith(".")
		? resolve(dirname(path), command)
		: command;
	const nodeScript =
		isAbsolute(resolvedCommand) && NODE_SCRIPT_PATTERN.test(resolvedCommand);
	return {
		name,
		description: optionalString(value["description"], "description", path),
		output: optionalString(value["output"], "output", path),
		deferLoading: deferLoading(value["defer_loading"], path),
		command: nodeScript ? process.execPath : resolvedCommand,
		args: nodeScript ? [resolvedCommand, ...args] : args,
		input: inputMode(value["input"], path),
		sourcePath: path,
	};
}

export function discoverDynamicTools(
	dir: string = getDynamicToolsDir(),
): DynamicToolDefinition[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((entry) => {
			const path = join(dir, entry.name);
			return parseDynamicTool(path, readFileSync(path, "utf8"));
		});
}
