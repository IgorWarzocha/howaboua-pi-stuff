import { shortHash } from "./signatures.ts";

type ToolFamily = "function" | "custom" | "search";

type PairedCall = {
	family: ToolFamily;
	id: string;
	index: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function callId(item: unknown): string | undefined {
	return isRecord(item) && typeof item["call_id"] === "string"
		? item["call_id"]
		: undefined;
}

function callFamily(item: unknown): ToolFamily | undefined {
	if (!isRecord(item)) return undefined;
	if (item["type"] === "function_call" || item["type"] === "local_shell_call")
		return "function";
	if (item["type"] === "custom_tool_call") return "custom";
	if (item["type"] === "tool_search_call") return "search";
	return undefined;
}

function outputFamily(item: unknown): ToolFamily | undefined {
	if (!isRecord(item)) return undefined;
	if (item["type"] === "function_call_output") return "function";
	if (item["type"] === "custom_tool_call_output") return "custom";
	if (
		item["type"] === "tool_search_output" &&
		item["execution"] !== "server" &&
		typeof item["call_id"] === "string"
	)
		return "search";
	return undefined;
}

function syntheticOutputId(
	prefix: string,
	call: Record<string, unknown>,
): string | undefined {
	const sourceId = call["id"];
	return typeof sourceId === "string" && sourceId !== ""
		? `${prefix}_${shortHash(`${prefix}:${sourceId}`)}`
		: undefined;
}

function syntheticOutput(
	call: Record<string, unknown>,
	family: ToolFamily,
	id: string,
): Record<string, unknown> {
	if (family === "custom") {
		const outputId = syntheticOutputId("ctco", call);
		return {
			type: "custom_tool_call_output",
			...(outputId ? { id: outputId } : {}),
			call_id: id,
			output: "aborted",
		};
	}
	if (family === "search") {
		const outputId = syntheticOutputId("tso", call);
		return {
			type: "tool_search_output",
			...(outputId ? { id: outputId } : {}),
			call_id: id,
			status: "completed",
			execution: "client",
			tools: [],
		};
	}
	const outputId = syntheticOutputId("fco", call);
	return {
		type: "function_call_output",
		...(outputId ? { id: outputId } : {}),
		call_id: id,
		output: "aborted",
	};
}

/** Keep Responses tool calls and outputs paired after arbitrary history rewrites. */
export function normalizeResponsesToolHistory(
	input: readonly unknown[],
): unknown[] {
	const calls = new Map<string, PairedCall>();
	const validCalls = new Set<number>();
	const droppedCalls = new Set<number>();
	for (let index = 0; index < input.length; index++) {
		const item = input[index];
		const family = callFamily(item);
		const id = callId(item);
		if (!family || id === undefined) continue;
		if (id === "" || !isRecord(item) || calls.has(id)) {
			droppedCalls.add(index);
			continue;
		}
		calls.set(id, { family, id, index });
		validCalls.add(index);
	}

	const matchedCalls = new Set<string>();
	const droppedOutputs = new Set<number>();
	for (let index = 0; index < input.length; index++) {
		const item = input[index];
		const family = outputFamily(item);
		const id = callId(item);
		if (!family) continue;
		const call = id === undefined ? undefined : calls.get(id);
		if (
			!call ||
			call.family !== family ||
			call.index >= index ||
			matchedCalls.has(call.id)
		) {
			droppedOutputs.add(index);
			continue;
		}
		matchedCalls.add(call.id);
	}

	let normalized: unknown[] | undefined;
	for (let index = 0; index < input.length; index++) {
		const item = input[index];
		const family = callFamily(item);
		const drop = droppedCalls.has(index) || droppedOutputs.has(index);
		if (drop) {
			normalized ??= input.slice(0, index);
			continue;
		}
		if (normalized) normalized.push(item);
		const id = callId(item);
		if (
			!family ||
			!validCalls.has(index) ||
			!isRecord(item) ||
			id === undefined
		)
			continue;
		if (matchedCalls.has(id)) continue;
		normalized ??= input.slice(0, index + 1);
		normalized.push(syntheticOutput(item, family, id));
	}

	return normalized ?? (input as unknown[]);
}
