import { compile } from "@earendil-works/pi-schema";
import type { CodeModeToolDefinition } from "./types.js";

const schemaChecks = new WeakMap<object, ReturnType<typeof compile>>();
const always = compile(true);
const never = compile(false);

function inputValidator(schema: unknown) {
	if (schema === true) return always;
	if (schema === false) return never;
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
	let validator = schemaChecks.get(schema);
	if (!validator) {
		validator = compile(schema, { unresolvedRefs: "reject" });
		schemaChecks.set(schema, validator);
	}
	return validator;
}

/** Decode equivalent structured requests before hooks and blocking classification. */
export function prepareCodeModeToolInput(tool: CodeModeToolDefinition, input: unknown): unknown {
	if ("command" in tool) {
		if (input !== null && typeof input === "object") return JSON.stringify(input);
		return input;
	}
	// Freeform strings and schema-valid strings belong to the tool, not this adapter.
	if (tool.kind !== "function" || typeof input !== "string") return input;
	const text = input.trim();
	const validator = inputValidator(tool.inputSchema);
	if (!validator || validator.check(input)) return input;
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
