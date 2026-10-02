import {
	createToolSearchExtension,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatCodeModeToolHelp, isCodeModeToolDiscoverable } from "../../tools/code-mode/custom-tool-prompt.ts";
import { codeModeGlobalName } from "../../tools/code-mode/tool-identity.ts";
import type { CodeModeToolDefinition, ProgrammaticCodeModeToolDefinition } from "../../tools/code-mode/types.ts";

const SEARCH_NAME = "tool_search";
const EMPTY_SCHEMA = Type.Object({});

/** Reuse Pi's search owner, with the existing callable catalogue as its metadata view. */
export async function registerCodeModeToolSearch(
	pi: ExtensionAPI,
	getTools: (ctx: ExtensionContext) => CodeModeToolDefinition[],
	isActive: (ctx: ExtensionContext) => boolean,
): Promise<{ getTools(knownMcpNames?: readonly string[]): ProgrammaticCodeModeToolDefinition[] }> {
	let context: ExtensionContext | undefined;
	let parameters: import("@earendil-works/pi-coding-agent").ToolDefinition["parameters"] | undefined;
	const description = "Find callable tool contracts by query; returns usage and full metadata";
	const catalog = () => context && isActive(context) ? getTools(context).filter(isCodeModeToolDiscoverable) : [];
	const isOwnedSearch = () => {
		const registered = pi.getAllTools();
		const source = registered.find(tool => tool.name === SEARCH_NAME)?.sourceInfo?.path;
		return source !== undefined && source === registered.find(tool => tool.name === "exec")?.sourceInfo?.path
			&& registered.find(tool => tool.name === SEARCH_NAME)?.exposure === "codemode";
	};
	// This public factory owns validation, ranking and loadout changes. No SDK internals or tool patch.
	await createToolSearchExtension()({
		...pi,
		registerTool(native) {
			parameters = native.parameters;
			pi.registerTool({
				...native,
				exposure: "codemode",
				description,
				promptSnippet: "Find tool contracts",
			});
		},
		getAllTools() {
			const registered = pi.getAllTools();
			const owned = catalog();
			const originalNames = new Set([SEARCH_NAME, ...owned.flatMap(tool => [tool.name, tool.topLevelName ?? tool.name])]);
			const metadata: ToolInfo[] = owned.map(tool => ({
				name: codeModeGlobalName(tool.name),
				description: formatCodeModeToolHelp(tool),
				// The complete schema is already in the searchable help text.
				parameters: EMPTY_SCHEMA,
				exposure: "codemode",
				...(tool.namespace ? { namespace: tool.namespace } : {}),
				sourceInfo: { path: "<code-mode-catalog>", source: "inline", scope: "temporary", origin: "top-level" },
			}));
			return [...registered.filter(tool => !originalNames.has(tool.name)), ...metadata];
		},
		getActiveTools() {
			const owned = new Set(catalog().flatMap(tool => [tool.name, tool.topLevelName ?? tool.name]));
			// Contracts remain searchable after a tool was used or promoted.
			return pi.getActiveTools().filter(name => !owned.has(name));
		},
		setActiveTools(names) {
			const owned = new Map(catalog().map(tool => [codeModeGlobalName(tool.name), tool]));
			const native = names.flatMap(name => {
				const tool = owned.get(name);
				// Nested/custom contracts do not activate their native declarations.
				return !tool ? [name] : "executionPipeline" in tool && tool.executionPipeline === "pi" ? [tool.name] : [];
			});
			pi.setActiveTools([...new Set([...pi.getActiveTools(), ...native])]);
		},
	});
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName === SEARCH_NAME && isOwnedSearch()) context = ctx;
		// Pi's MCP hook still recognizes the factory's unchanged name/schema and waits before execution.
	});
	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== SEARCH_NAME || event.isError || !isOwnedSearch() || !isActive(ctx)) return;
		context = ctx;
		const details = event.details;
		if (!details || typeof details !== "object" || !("loaded" in details)
			|| !Array.isArray(details.loaded) || !details.loaded.every((name: unknown) => typeof name === "string"))
			return;
		if (!details.loaded.length) return;
		const owned = new Map(catalog().map(tool => [codeModeGlobalName(tool.name), tool]));
		const registered = new Map(pi.getAllTools().map(tool => [tool.name, tool]));
		const contracts = details.loaded.map((name: string) => {
			const tool = owned.get(name);
			if (tool) return `- ${name}\n${formatCodeModeToolHelp(tool)}`;
			const native = registered.get(name);
			return native && native.exposure !== "hidden"
				? [
					`- ${name}\nNative tool\n${native.description}`,
					...(native.promptGuidelines ?? []),
					native.namespace?.instructions ? `Instructions: ${native.namespace.instructions}` : undefined,
					`Schema: ${JSON.stringify(native.parameters)}`,
					native.annotations ? `Annotations: ${JSON.stringify(native.annotations)}` : undefined,
				].filter(Boolean).join("\n")
				: `Tool ${name} is no longer available; search again`;
		});
		// Supported transformation of this NEW result before persistence, never a history rewrite.
		const loaded = details.loaded.flatMap((name: string) => {
			const tool = owned.get(name);
			return !tool ? [name] : "executionPipeline" in tool && tool.executionPipeline === "pi" ? [tool.name] : [];
		});
		const unavailable = details.loaded.some((name: string) => !owned.has(name)
			&& (!registered.has(name) || registered.get(name)?.exposure === "hidden"));
		return { content: [{ type: "text", text: contracts.join("\n\n") }],
			...(unavailable ? { isError: true } : {}),
			details: { ...details, loaded, matches: details.loaded } };
	});
	pi.on("session_shutdown", () => { context = undefined; });
	if (!parameters) throw new Error("Pi tool-search registration did not provide a definition");
	const inputSchema = parameters;
	return { getTools: (knownMcpNames = []) => !isOwnedSearch() ? [] : [{
		name: SEARCH_NAME,
		usage: "await tools.tool_search({ query: string, limit?: number })",
		description,
		kind: "function",
		deferLoading: true,
		discoverWhenDeferred: true,
		executionPipeline: "pi",
		inputSchema,
		async invoke(input, ctx, signal) {
			if (!ctx.executeTool) throw new Error("Pi nested tool executor is unavailable");
			const outcome = await ctx.executeTool(SEARCH_NAME, input, { signal,
				...(ctx.onUpdate ? { onUpdate: ctx.onUpdate } : {}) });
			ctx.captureResult?.(outcome.result);
			const text = outcome.result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
			if (outcome.isError) throw new Error(text || "Tool search failed");
			const details = outcome.result.details;
			const loaded = details && typeof details === "object" && "loaded" in details && Array.isArray(details.loaded)
				? details.loaded : [];
			const freshMcp = pi.getAllTools().filter(tool => tool.sourceInfo?.path === "builtin:mcp"
				&& loaded.includes(tool.name) && !knownMcpNames.includes(tool.name));
			return freshMcp.length
				? text + "\n\nNewly connected bindings: " + freshMcp.map(tool => codeModeGlobalName(tool.name)).join(", ")
					+ ". Call them in the next exec cell"
				: text;
		},
	}] };
}
