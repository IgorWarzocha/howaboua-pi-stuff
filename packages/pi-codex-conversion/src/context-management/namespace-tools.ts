import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	type ToolCall,
} from "@earendil-works/pi-ai";
import {
	HISTORY_ACTIONS,
	HISTORY_DESCRIPTION,
	NOTES_ACTIONS,
	NOTES_DESCRIPTION,
} from "./tool-contract.ts";

type JsonSchema = Record<string, unknown>;
type ContextNamespace = "history" | "notes";

const ACTIONS = {
	history: new Set<string>(HISTORY_ACTIONS),
	notes: new Set<string>(NOTES_ACTIONS),
} satisfies Record<ContextNamespace, ReadonlySet<string>>;

function nullable(type: string, description?: string): JsonSchema {
	return {
		...(description ? { description } : {}),
		anyOf: [{ type }, { type: "null" }],
	};
}

function nullableRole(): JsonSchema {
	return {
		anyOf: [
			{
				type: "string",
				enum: ["user", "assistant", "tool", "system", "developer"],
			},
			{ type: "null" },
		],
	};
}

function string(description?: string, encrypted = false): JsonSchema {
	return {
		type: "string",
		...(description ? { description } : {}),
		...(encrypted ? { encrypted: true } : {}),
	};
}

function integer(minimum?: number): JsonSchema {
	return {
		type: "integer",
		...(minimum === undefined ? {} : { minimum }),
	};
}

function object(
	properties: Record<string, JsonSchema>,
	required?: string[],
) {
	return {
		type: "object",
		properties,
		...(required ? { required } : {}),
		additionalProperties: false,
	};
}

function operation(
	name: string,
	description: string,
	parameters: ReturnType<typeof object>,
) {
	return { type: "function", name, description, strict: false, parameters };
}

function historyNamespace(encrypted: boolean) {
	return {
		type: "namespace",
		name: "history",
		description: HISTORY_DESCRIPTION,
		tools: [
			operation(
				"list_windows",
				"List context windows",
				object({
					agent_name: nullable("string"),
					limit: integer(1),
					recent_first: { type: "boolean" },
				}),
			),
			operation(
				"list_items",
				"List history items",
				object({
					agent_name: nullable("string"),
					limit: integer(1),
					max_chars_per_item: integer(1),
					recent_first: { type: "boolean" },
					role: nullableRole(),
					tool_name: nullable("string"),
					tool_namespace: nullable("string"),
					window_id: nullable("string"),
				}),
			),
			operation(
				"read_item",
				"Read history item range",
				object(
					{
						agent_name: nullable("string"),
						item_id: {
							type: "string",
							description: "Suffix from the item's [id: …] marker.",
						},
						limit_chars: integer(1),
						offset_chars: integer(0),
						window_id: { type: "string" },
					},
					["item_id", "window_id"],
				),
			),
			operation(
				"search_contents",
				"Search history",
				object(
					{
						agent_name: nullable("string"),
						limit: integer(1),
						query: string("Case-sensitive", encrypted),
						recent_first: { type: "boolean" },
						role: nullableRole(),
						tool_name: nullable("string"),
						tool_namespace: nullable("string"),
						window_id: nullable("string"),
					},
					["query"],
				),
			),
		],
	};
}

function notesNamespace(encrypted: boolean) {
	return {
		type: "namespace",
		name: "notes",
		description: NOTES_DESCRIPTION,
		tools: [
			operation(
				"list_files_by_prefix",
				"List note files",
				object({
					file_order: {
						type: "string",
						enum: ["ascending", "descending"],
					},
					file_order_by: {
						type: "string",
						enum: ["name", "created_at", "updated_at"],
					},
					max_results: integer(1),
					prefix: nullable("string"),
				}),
			),
			operation(
				"read_file",
				"Read note file; line bounds inclusive, 1-based, negative from end",
				object(
					{
						path: { type: "string" },
						start_line: nullable("integer"),
						stop_line: nullable("integer"),
					},
					["path"],
				),
			),
			operation(
				"search_contents",
				"Search note lines by literal substring",
				object(
					{
						max_files: integer(1),
						max_matches_per_file: integer(1),
						path_prefix: nullable("string"),
						query: string("Case-sensitive", encrypted),
						recent_file_first: { type: "boolean" },
					},
					["query"],
				),
			),
			operation(
				"append_to_file",
				"Append text exactly",
				object(
					{
						path: { type: "string" },
						text: string(undefined, encrypted),
					},
					["text", "path"],
				),
			),
			operation(
				"write_file",
				"Create or replace a note file",
				object(
					{
						path: { type: "string" },
						text: string(undefined, encrypted),
					},
					["text", "path"],
				),
			),
		],
	};
}

function contextNamespace(
	name: ContextNamespace,
	encrypted: boolean,
): Record<string, unknown> {
	const namespace = name === "history"
		? historyNamespace(encrypted)
		: notesNamespace(encrypted);
	// Codex validates reserved schemas against its serialized contract: open
	// objects, with numeric bounds omitted by its JsonSchema serializer.
	if (!encrypted) return namespace;
	return {
		...namespace,
		tools: namespace.tools.map((tool) => {
			const { additionalProperties: _additionalProperties, ...parameters } = tool.parameters;
			for (const property of Object.values(parameters.properties)) {
				delete property["minimum"];
			}
			return { ...tool, parameters };
		}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function namespaceName(value: unknown): ContextNamespace | undefined {
	if (!isRecord(value)) return undefined;
	const name = value["name"];
	return (name === "history" || name === "notes") &&
		(value["type"] === "function" || value["type"] === "namespace")
		? name
		: undefined;
}

function rewriteTools(
	tools: readonly unknown[],
	encrypted: boolean,
): { tools: unknown[]; changed: boolean } {
	let changed = false;
	const rewritten = tools.map((tool) => {
		const name = namespaceName(tool);
		if (!name) return tool;
		changed = true;
		return contextNamespace(name, encrypted);
	});
	return { tools: rewritten, changed };
}

export function rewriteContextNamespaceTools(
	payload: unknown,
	options: { encrypted?: boolean } = {},
): unknown {
	if (!isRecord(payload)) return payload;
	const encrypted = options.encrypted === true;
	let changed = false;
	let tools = payload["tools"];
	if (Array.isArray(tools)) {
		const result = rewriteTools(tools, encrypted);
		tools = result.tools;
		changed ||= result.changed;
	}
	let input = payload["input"];
	if (Array.isArray(input)) {
		input = input.map((item) => {
			if (!isRecord(item) || !Array.isArray(item["tools"])) return item;
			const result = rewriteTools(item["tools"], encrypted);
			if (!result.changed) return item;
			changed = true;
			return { ...item, tools: result.tools };
		});
	}
	return changed ? { ...payload, tools, input } : payload;
}

export function hasContextNamespaceRouters(
	context: Pick<Context, "tools">,
): boolean {
	const names = new Set(context.tools?.map((tool) => tool.name));
	return names.has("history") && names.has("notes");
}

function routedAction(call: ToolCall): string | undefined {
	if (call.namespace !== "history" && call.namespace !== "notes")
		return undefined;
	return ACTIONS[call.namespace].has(call.name) ? call.name : undefined;
}

function routeContextNamespaceToolCall(call: ToolCall): ToolCall {
	const action = routedAction(call);
	if (!action || !call.namespace) return call;
	return {
		...call,
		name: call.namespace,
		arguments: { action, ...call.arguments },
	};
}

export function unrouteContextNamespaceToolCall(call: ToolCall): ToolCall {
	if (
		(call.namespace !== "history" && call.namespace !== "notes") ||
		call.name !== call.namespace
	)
		return call;
	const action = call.arguments["action"];
	if (typeof action !== "string" || !ACTIONS[call.namespace].has(action))
		return call;
	const args = { ...call.arguments };
	delete args["action"];
	return { ...call, name: action, arguments: args };
}

function routeMessage(message: AssistantMessage): AssistantMessage {
	return {
		...message,
		content: message.content.map((block) =>
			block.type === "toolCall"
				? routeContextNamespaceToolCall(block)
				: block,
		),
	};
}

function routeEvent(event: AssistantMessageEvent): AssistantMessageEvent {
	if (event.type === "done")
		return { ...event, message: routeMessage(event.message) };
	if (event.type === "error")
		return { ...event, error: routeMessage(event.error) };
	const partial = routeMessage(event.partial);
	return event.type === "toolcall_end"
		? {
				...event,
				toolCall: routeContextNamespaceToolCall(event.toolCall),
				partial,
			}
		: { ...event, partial };
}

export function routeContextNamespaceToolStream(
	source: AssistantMessageEventStream,
): AssistantMessageEventStream {
	const output = createAssistantMessageEventStream();
	void (async () => {
		let latest: AssistantMessage | undefined;
		try {
			for await (const event of source) {
				const routed = routeEvent(event);
				latest = routed.type === "done"
					? routed.message
					: routed.type === "error"
						? routed.error
						: routed.partial;
				output.push(routed);
				if (routed.type === "done") output.end(routed.message);
				if (routed.type === "error") output.end(routed.error);
			}
		} catch (error) {
			if (!latest) throw error;
			const failed: AssistantMessage = {
				...latest,
				stopReason: "error",
				errorMessage: error instanceof Error ? error.message : String(error),
			};
			output.push({ type: "error", reason: "error", error: failed });
			output.end(failed);
		}
	})();
	return output;
}
