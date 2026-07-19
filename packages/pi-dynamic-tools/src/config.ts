import { readdirSync, readFileSync } from "node:fs";
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

export function getProjectDynamicToolsDir(
	launchDir: string = process.cwd(),
): string {
	return join(launchDir, ".pi", DYNAMIC_TOOLS_DIRNAME);
}

export interface DynamicToolDiscoveryError {
	path: string;
	message: string;
}

export interface DynamicToolDiscoveryResult {
	tools: DynamicToolDefinition[];
	errors: DynamicToolDiscoveryError[];
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

function optionalNonNegativeInteger(
	value: unknown,
	field: string,
	path: string,
): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || Number(value) < 0)
		throw new Error(`${path}: ${field} must be a non-negative safe integer`);
	return Number(value);
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
		"usage",
		"description",
		"output",
		"defer_loading",
		"command",
		"args",
		"input",
		"yield_time_ms",
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
	const yieldTimeMs = optionalNonNegativeInteger(
		value["yield_time_ms"],
		"yield_time_ms",
		path,
	);
	return {
		name,
		usage: requiredString(value["usage"], "usage", path),
		description: optionalString(value["description"], "description", path),
		output: optionalString(value["output"], "output", path),
		deferLoading: deferLoading(value["defer_loading"], path),
		command: nodeScript ? process.execPath : resolvedCommand,
		args: nodeScript ? [resolvedCommand, ...args] : args,
		input: inputMode(value["input"], path),
		...(yieldTimeMs === undefined ? {} : { yieldTimeMs }),
		sourcePath: path,
	};
}

export function discoverDynamicToolsFromDirectories(
	dirs: readonly string[],
): DynamicToolDiscoveryResult {
	const byName = new Map<string, DynamicToolDefinition>();
	const errors: DynamicToolDiscoveryError[] = [];
	for (const dir of dirs) {
		for (const path of dynamicToolPaths(dir, errors)) {
			const name = basename(path, extname(path));
			// A project-local definition claims its name even when invalid. Never
			// silently fall back to a global tool with different behavior.
			byName.delete(name);
			const tool = loadDynamicTool(path, errors);
			if (tool) byName.set(tool.name, tool);
		}
	}
	return {
		tools: [...byName.values()].sort((left, right) =>
			left.name.localeCompare(right.name),
		),
		errors,
	};
}

export function discoverDynamicTools(
	dir: string = getDynamicToolsDir(),
): DynamicToolDiscoveryResult {
	const errors: DynamicToolDiscoveryError[] = [];
	const tools = dynamicToolPaths(dir, errors)
		.map((path) => loadDynamicTool(path, errors))
		.filter((tool): tool is DynamicToolDefinition => tool !== undefined);
	return { tools, errors };
}

function dynamicToolPaths(
	dir: string,
	errors: DynamicToolDiscoveryError[],
): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((entry) => join(dir, entry.name));
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return [];
		const detail = error instanceof Error ? error.message : String(error);
		errors.push({ path: dir, message: `${dir}: ${detail}` });
		return [];
	}
}

function loadDynamicTool(
	path: string,
	errors: DynamicToolDiscoveryError[],
): DynamicToolDefinition | undefined {
	try {
		return parseDynamicTool(path, readFileSync(path, "utf8"));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		const message = detail.startsWith(`${path}:`)
			? detail
			: `${path}: ${detail}`;
		const name = basename(path, extname(path));
		if (!TOOL_NAME_PATTERN.test(name)) {
			errors.push({ path, message });
			return undefined;
		}
		return {
			name,
			usage: "Disabled: fix this tool's TOML definition before calling it.",
			description: message,
			deferLoading: true,
			command: "",
			args: [],
			input: "arg",
			sourcePath: path,
			disabledReason: message,
		};
	}
}
