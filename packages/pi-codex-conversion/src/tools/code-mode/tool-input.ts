import { IsSchema } from "typebox";
import { Check } from "typebox/value";
import type { CodeModeToolDefinition } from "./types.js";

/** Decode equivalent structured requests before hooks and blocking classification. */
export function prepareCodeModeToolInput(tool: CodeModeToolDefinition, input: unknown): unknown {
	if ("command" in tool) {
		if (input !== null && typeof input === "object") return JSON.stringify(input);
		return input;
	}
	// Freeform strings and schema-valid strings belong to the tool, not this adapter.
	if (tool.kind !== "function" || typeof input !== "string") return input;
	const text = input.trim();
	if (!IsSchema(tool.inputSchema) || Check(tool.inputSchema, input)) return input;
	if (tool.discovery === "help" && text === "help") return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`Invalid ${tool.name} arguments; use a structured request or valid JSON`);
	}
	if (parsed === null || typeof parsed !== "object")
		throw new Error(`Invalid ${tool.name} arguments; use a structured request or JSON object or array`);
	return parsed;
}
