const CODE_MODE_EXEC_GRAMMAR = String.raw`
start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`;

interface ResponsesLikeBody {
	tools?: unknown[] | undefined;
	input?: unknown[] | undefined;
	[key: string]: unknown;
}

export function applyCodeModeFreeformContract<T extends ResponsesLikeBody>(
	body: T,
): T {
	const execCallIds = new Set<string>();
	const input = (body.input ?? []).map((item) => {
		if (!isRecord(item)) return item;
		if (item["type"] === "additional_tools" && Array.isArray(item["tools"])) {
			return { ...item, tools: item["tools"].map(toCodeModeTool) };
		}
		if (item["type"] === "custom_tool_call" && item["name"] === "exec") {
			if (typeof item["call_id"] === "string") execCallIds.add(item["call_id"]);
			return item;
		}
		if (item["type"] !== "function_call" || item["name"] !== "exec")
			return item;
		const callId =
			typeof item["call_id"] === "string" ? item["call_id"] : undefined;
		if (callId) execCallIds.add(callId);
		const { arguments: _arguments, id, ...rest } = item;
		return {
			...rest,
			...(typeof id === "string" && id.startsWith("ctc_") ? { id } : {}),
			type: "custom_tool_call",
			input: execSourceFromArguments(item["arguments"]),
		};
	});
	const rewrittenInput = input.map((item) => {
		if (!isRecord(item) || item["type"] !== "function_call_output") return item;
		if (
			typeof item["call_id"] !== "string" ||
			!execCallIds.has(item["call_id"])
		)
			return item;
		return { ...item, type: "custom_tool_call_output" };
	});
	return {
		...body,
		...(body.tools ? { tools: body.tools.map(toCodeModeTool) } : {}),
		...(body.input ? { input: rewrittenInput } : {}),
	};
}

export function sanitizeCodeModeHistoryForFunctionTools<T extends ResponsesLikeBody>(
	body: T,
): T {
	if (!body.input) return body;
	let changed = false;
	const input = body.input.map((item) => {
		if (
			!isRecord(item)
			|| item["type"] !== "function_call"
			|| typeof item["id"] !== "string"
			|| !item["id"].startsWith("ctc_")
		)
			return item;
		changed = true;
		const { id: _id, ...rest } = item;
		return rest;
	});
	if (!changed) return body;
	return {
		...body,
		input,
	};
}

function toCodeModeTool(tool: unknown): unknown {
	if (!isRecord(tool) || tool["type"] !== "function" || tool["name"] !== "exec")
		return tool;
	return {
		type: "custom",
		name: "exec",
		description:
			typeof tool["description"] === "string"
				? tool["description"]
				: "Run JavaScript to compose tools.",
		format: {
			type: "grammar",
			syntax: "lark",
			definition: CODE_MODE_EXEC_GRAMMAR,
		},
	};
}

function execSourceFromArguments(value: unknown): string {
	if (typeof value !== "string") return "";
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) && typeof parsed["code"] === "string"
			? parsed["code"]
			: value;
	} catch {
		return value;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
