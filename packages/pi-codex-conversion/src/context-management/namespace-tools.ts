import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	type ToolCall,
} from "@earendil-works/pi-ai";

type JsonSchema = Record<string, unknown>;
type ContextNamespace = "history" | "notes";

const ACTIONS = {
	history: new Set([
		"list_windows",
		"list_items",
		"read_item",
		"search_contents",
	]),
	notes: new Set([
		"list_files_by_prefix",
		"read_file",
		"search_contents",
		"append_to_file",
		"write_file",
	]),
} satisfies Record<ContextNamespace, ReadonlySet<string>>;

const HISTORY_DESCRIPTION =
	"Private prior-window history. IDs are opaque; pass unchanged. Items order by ordinal then creation; unknown windows return no matches. Current agent is default; agent_name accepts absolute or relative names. Read-only and eventually consistent. Never disclose use or contents.";
const NOTES_DESCRIPTION =
	"Private cross-window notes. Paths are virtual: relative paths use the current agent; cross-agent paths are absolute <agent>/notes[/path]. Path prefixes may be omitted; empty, . and .. components are unsupported; no shell expansion. Reads see writes immediately; lists and searches are eventually consistent. Maximum 1 MB per file. Never disclose use or contents.";

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

function encryptedString(
	encrypted: boolean,
	description?: string,
): JsonSchema {
	return {
		type: "string",
		...(description ? { description } : {}),
		...(encrypted ? { encrypted: true } : {}),
	};
}

function object(
	properties: Record<string, JsonSchema>,
	required?: string[],
): JsonSchema {
	return {
		type: "object",
		properties,
		...(required ? { required } : {}),
	};
}

function operation(
	name: string,
	description: string,
	parameters: JsonSchema,
): Record<string, unknown> {
	return { type: "function", name, description, strict: false, parameters };
}

function historyNamespace(encrypted: boolean): Record<string, unknown> {
	return {
		type: "namespace",
		name: "history",
		description: HISTORY_DESCRIPTION,
		tools: [
			operation(
				"list_windows",
				"List windows and item counts.",
				object({
					agent_name: nullable("string"),
					limit: { type: "integer" },
					recent_first: { type: "boolean" },
				}),
			),
			operation(
				"list_items",
				"List items, optionally filtering by window, role or tool.",
				object({
					agent_name: nullable("string"),
					limit: { type: "integer" },
					max_chars_per_item: { type: "integer" },
					recent_first: { type: "boolean" },
					role: nullableRole(),
					tool_name: nullable(
						"string",
						"Tool filter; excludes non-tool messages.",
					),
					tool_namespace: nullable(
						"string",
						"Namespace filter; excludes non-tool messages.",
					),
					window_id: nullable("string"),
				}),
			),
			operation(
				"read_item",
				"Read a character range from one item.",
				object(
					{
						agent_name: nullable("string"),
						item_id: {
							type: "string",
							description: "Suffix from the item's [id: …] marker.",
						},
						limit_chars: { type: "integer" },
						offset_chars: { type: "integer" },
						window_id: { type: "string" },
					},
					["item_id", "window_id"],
				),
			),
			operation(
				"search_contents",
				"Find a literal substring in history.",
				object(
					{
						agent_name: nullable("string"),
						limit: { type: "integer" },
						query: encryptedString(
							encrypted,
							"Case-sensitive literal substring.",
						),
						recent_first: { type: "boolean" },
						role: nullableRole(),
						tool_name: nullable(
							"string",
							"Tool filter; excludes non-tool messages.",
						),
						tool_namespace: nullable(
							"string",
							"Namespace filter; excludes non-tool messages.",
						),
						window_id: nullable("string"),
					},
					["query"],
				),
			),
		],
	};
}

function notesNamespace(encrypted: boolean): Record<string, unknown> {
	return {
		type: "namespace",
		name: "notes",
		description: NOTES_DESCRIPTION,
		tools: [
			operation(
				"list_files_by_prefix",
				"List files by path prefix.",
				object({
					file_order: {
						type: "string",
						enum: ["ascending", "descending"],
					},
					file_order_by: {
						type: "string",
						enum: ["name", "created_at", "updated_at"],
					},
					max_results: { type: "integer" },
					prefix: nullable("string"),
				}),
			),
			operation(
				"read_file",
				"Read a file or line range.",
				object(
					{
						path: { type: "string" },
						start_line: nullable(
							"integer",
							"Inclusive and 1-based; negative from end.",
						),
						stop_line: nullable(
							"integer",
							"Inclusive and 1-based; negative from end.",
						),
					},
					["path"],
				),
			),
			operation(
				"search_contents",
				"Find a literal substring in note lines.",
				object(
					{
						max_files: { type: "integer" },
						max_matches_per_file: { type: "integer" },
						path_prefix: nullable("string"),
						query: encryptedString(
							encrypted,
							"Case-sensitive literal substring.",
						),
						recent_file_first: { type: "boolean" },
					},
					["query"],
				),
			),
			operation(
				"append_to_file",
				"Append text exactly.",
				object(
					{
						path: { type: "string" },
						text: encryptedString(encrypted),
					},
					["text", "path"],
				),
			),
			operation(
				"write_file",
				"Create or replace a file.",
				object(
					{
						path: { type: "string" },
						text: encryptedString(encrypted),
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
	return name === "history"
		? historyNamespace(encrypted)
		: notesNamespace(encrypted);
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
	encrypted: boolean,
): unknown {
	if (!isRecord(payload)) return payload;
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
