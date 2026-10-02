import assert from "node:assert/strict";
import test from "node:test";
import { convertToLlm, SessionManager, type ToolDefinition, type ToolResultEvent, type ToolResultEventResult } from "@earendil-works/pi-coding-agent";
import { createMcpCodeModeBridge } from "../src/adapter/code-mode/mcp-tools.ts";
import { CODEX_TOOLKIT_UPDATE_TYPE, readToolkitUpdate, recordCodeModeToolkit } from "../src/adapter/code-mode/toolkit-updates.ts";
import { projectCodexDeveloperHistory } from "../src/adapter/developer-history.ts";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { buildCodeModeToolsPrompt, formatCodeModeToolHelp } from "../src/tools/code-mode/custom-tool-prompt.ts";
import { scopeAllToolsToDiscoverable } from "../src/tools/code-mode/host-client.ts";
import { toWireToolDefinition } from "../src/tools/code-mode/host-protocol.ts";
import { codeModeGlobalName } from "../src/tools/code-mode/tool-identity.ts";
import { notebookBootstrapSource } from "../src/tools/notebook-mode/kernel-runtime.ts";
import { registerCodeModeToolSearch } from "../src/adapter/code-mode/tool-search.ts";
import { CodeModeDelegateRuntime } from "../src/tools/code-mode/delegate-runtime.ts";
import { createHistoryNotesTools } from "../src/context-management/history-notes.ts";
import { toNestedTool } from "../src/adapter/code-mode/nested-tool-adapter.ts";
import type {
	CustomToolDefinition,
	ProgrammaticCodeModeToolDefinition,
} from "../src/tools/code-mode/types.ts";

const bundled: ProgrammaticCodeModeToolDefinition = {
	name: "exec_command",
	usage: "await tools.exec_command({ cmd })",
	description: "Run command",
	deferLoading: false,
	kind: "function",
	inputSchema: { type: "object" },
	async invoke() {
		return "";
	},
};

function customTool(
	name: string,
	deferLoading: boolean,
): CustomToolDefinition {
	return {
		name,
		usage: `await tools.${name}(input)`,
		description: `${name} help`,
		deferLoading,
		command: name,
		args: [],
		input: "arg",
		sourcePath: `/${name}.toml`,
	};
}

test("custom-tool discovery and availability share the callable catalog without importing ordinary extensions", async () => {
	const promoted = customTool("promoted_tool", false);
	const deferred = customTool("deferred_tool", true);
	const deferredProgrammatic = {
		...bundled,
		name: "deferred-programmatic-tool",
		usage: 'await tools["deferred-programmatic-tool"]({ cmd })',
		deferLoading: true,
		discoverWhenDeferred: true,
	};
	const native = {
		name: "mcp__records__lookup", description: "Find records", parameters: { type: "object" },
		outputSchema: { type: "object", properties: { content: { type: "array" } } },
	};
	const resource = { ...native, name: "list_mcp_resources" };
	const extension = { ...native, name: "mcp__pretender__lookup" };
	const hidden = { ...native, name: "mcp__records__hidden" };
	const mcp = createMcpCodeModeBridge({
		getAllTools: () => [native, resource, extension, hidden].map((tool) => ({
			...tool, sourceInfo: { path: tool === extension ? "/extension.ts" : "builtin:mcp" },
		})),
	} as never);
	const loadout = {
		declared: [native, extension], callable: [native, resource, extension], registered: [native, resource, extension, hidden],
		getExposure: (name: string) => name === resource.name ? "direct" as const : "codemode" as const,
		getNamespace: () => ({
			name: "mcp__records", description: "Record lookup",
			instructions: "Keep record IDs unchanged\nReturn source citations",
		}),
	};
	assert.deepEqual(mcp.prepareLoadout(loadout as never).hiddenDeclarations, [native.name]);
	const catalog = [bundled, promoted, deferred, deferredProgrammatic, ...mcp.getTools()];
	assert.match(formatCodeModeToolHelp(mcp.getTools()[0]!), /Output: .*"content"/);
	const state = {
		ALL_TOOLS: catalog.map((tool) => ({
			name: codeModeGlobalName(tool.name),
			description: toWireToolDefinition(tool).description,
		})),
	};
	const source = scopeAllToolsToDiscoverable("", catalog);
	Function("globalThis", source)(state);

	assert.deepEqual(state.ALL_TOOLS, [promoted, deferred, deferredProgrammatic, ...mcp.getTools()].map((tool) => ({
		name: codeModeGlobalName(tool.name), description: formatCodeModeToolHelp(tool),
	})));
	assert.match(state.ALL_TOOLS.find((tool) => tool.name === native.name)!.description,
		/Instructions: Keep record IDs unchanged\nReturn source citations/);
	assert(!state.ALL_TOOLS.find((tool) => tool.name === deferred.name)!.description.includes("Instructions:"));
	for (const mode of ["code", "notebook"] as const) {
		assert.equal(buildCodeModeToolsPrompt(catalog, mode), buildCodeModeToolsPrompt(catalog.map((tool) => ({
			...tool, namespace: tool.namespace ? { ...tool.namespace, instructions: "" } : undefined,
		})), mode));
	}
	assert.match(
		formatCodeModeToolHelp(deferredProgrammatic),
		/^Usage: await tools\.deferred_programmatic_tool\(\{ cmd \}\)/,
	);
	const manager = SessionManager.inMemory();
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "Find a record" }], timestamp: 1 });
	const ctx = { sessionManager: manager };
	const pi = { appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data) } as never;
	const messages = () => projectCodexDeveloperHistory(manager.getBranch());
	assert.equal(recordCodeModeToolkit(pi, ctx, messages(), catalog), true);
	const initial = messages();
	const inventory = initial.find((message) => message.role === "custom" && message.customType === CODEX_TOOLKIT_UPDATE_TYPE);
	assert(inventory?.role === "custom");
	assert(!String(inventory.content).includes(native.name));
	assert(!String(inventory.content).includes("Record lookup"));
	assert(!JSON.stringify(inventory).includes("Keep record IDs unchanged"));
	assert(!String(inventory.content).includes("promoted_tool"));
	assert(!JSON.stringify(inventory).includes("pretender"));
	assert(!JSON.stringify(inventory).includes(hidden.name));
	assert.equal(recordCodeModeToolkit(pi, ctx, initial, [...catalog].reverse()), false);
	const bridge = new CodexDeveloperMessageBridge();
	const system = { role: "system" as const, content: "Keep Pi's system instructions", timestamp: 0 };
	assert.deepEqual(convertToLlm(bridge.prepare([system, inventory], false)), [system, {
		role: "user", content: [{ type: "text", text: inventory.content }], timestamp: inventory.timestamp,
	}]);
	const carrier = bridge.prepare([inventory], true)[0]!;
	assert.equal(carrier.role, "custom");
	const payload = bridge.rewritePayload({ input: [{ role: "user", content: carrier.content }] }) as { input: Array<{ role: string; content: string }> };
	assert.equal(payload.input[0]!.role, "developer");
	assert.match(payload.input[0]!.content, /help in ALL_TOOLS/);
	const changedInstructions = catalog.map((tool) => tool.name === native.name
		? { ...tool, namespace: { ...loadout.getNamespace(), instructions: "Preserve opaque IDs" } } : tool);
	assert.equal(recordCodeModeToolkit(pi, ctx, initial, changedInstructions), false);
	assert(!JSON.stringify(messages().at(-1)).includes("Preserve opaque IDs"));

	const nextCatalog = catalog.filter((tool) => tool.name !== deferred.name).map((tool) => tool.name === native.name
		? { ...tool, inputSchema: { type: "object", required: ["id"] } } : tool);
	const priorBytes = JSON.stringify(initial);
	assert.equal(recordCodeModeToolkit(pi, ctx, initial, nextCatalog), true);
	assert.equal(JSON.stringify(initial), priorBytes);
	const delta = messages().at(-1)!;
	assert(delta.role === "custom");
	assert.match(JSON.stringify(delta), /Removed: deferred_tool/s);
	assert(!String(delta.content).includes(native.name));
	assert.equal(recordCodeModeToolkit(pi, ctx, messages(), nextCatalog), false);
	// A surviving delta cannot stand in for a full catalog lost at a context boundary.
	assert.equal(recordCodeModeToolkit(pi, ctx, [delta], nextCatalog), true);
	assert.match(JSON.stringify(messages().at(-1)), /help in ALL_TOOLS/);
	// One query returns complete contracts across the live owned catalogue, then calls a local command.
	const sites = { ...customTool("sites", true),
		usage: "await tools.sites(JSON.stringify({ resource, action }))", description: "Sites operations",
		command: process.execPath, args: ["-e", "process.stdout.write(process.argv[1])"], output: "Owned fixture receipt" };
	const [historyCore, notesCore] = createHistoryNotesTools();
	const deferredContract = { deferLoading: true, discoverWhenDeferred: true };
	const core = [
		toNestedTool(historyCore, "await tools.history({ action, ...args })", {}, deferredContract),
		toNestedTool(notesCore, "await tools.notes({ action, ...args })", {}, deferredContract),
	];
	const searchCatalog = [...catalog, sites, ...core];
	let search: ToolDefinition | undefined;
	let codeModeActive = true;
	let active: string[] = ["exec", resource.name];
	const handlers = new Map<string, (event: never, ctx: never) => unknown>();
	const searchPi = {
		registerTool: (tool: ToolDefinition) => { search = tool; },
		getAllTools: () => [
			{ ...bundled, name: "exec", sourceInfo: { path: "/conversion" }, exposure: "model-only" },
			{ ...search, sourceInfo: { path: "/conversion" } },
			...[native, resource].map(tool => ({
				...tool, exposure: tool === native ? "codemode" : "direct",
				namespace: loadout.getNamespace(), sourceInfo: { path: "builtin:mcp" },
			})),
		],
		getActiveTools: () => active,
		setActiveTools: (names: string[]) => {
			assert(names.every(name => searchPi.getAllTools().some(tool => tool.name === name)), "Catalogue-only names never enter native loadout");
			active = names;
		},
		on: (name: string, handler: (event: never, ctx: never) => unknown) => { handlers.set(name, handler); },
	};
	const searchBridge = await registerCodeModeToolSearch(searchPi as never, () => searchCatalog, () => codeModeActive);
	assert(search);
	assert.equal(search.exposure, "codemode");
	const [searchHelper] = searchBridge.getTools([native.name, resource.name]);
	assert(searchHelper);
	const searchState = { ALL_TOOLS: [...searchCatalog, searchHelper].map(tool => ({
		name: codeModeGlobalName(tool.name), description: toWireToolDefinition(tool).description,
	})) };
	Function("globalThis", scopeAllToolsToDiscoverable("", [...searchCatalog, searchHelper]))(searchState);
	assert(Array.isArray(searchState.ALL_TOOLS));
	assert.equal(searchState.ALL_TOOLS.find(tool => tool.name === "tool_search")?.description,
		formatCodeModeToolHelp(searchHelper));
	const query = { query: "sites notes history records deferred promoted", limit: 12 };
	handlers.get("tool_call")!({ toolName: "tool_search" } as never, ctx as never);
	const discovery = await search.execute("search", query, new AbortController().signal, undefined, ctx as never);
	const originalDiscovery = JSON.stringify(discovery);
	const expand = (result: typeof discovery) => handlers.get("tool_result")!({
		type: "tool_result", toolName: "tool_search", toolCallId: "search", input: query,
		...result, isError: false,
	} as ToolResultEvent as never, ctx as never) as ToolResultEventResult;
	const complete = expand(discovery);
	assert.deepEqual(complete.details, { loaded: [native.name, resource.name],
		matches: (discovery.details as { loaded: string[] }).loaded });
	const contracts = complete.content!.filter(block => block.type === "text").map(block => block.text).join("\n");
	for (const tool of [sites, ...core, promoted, deferred, ...mcp.getTools()])
		assert(contracts.includes(formatCodeModeToolHelp(tool)), `Complete contract for ${tool.name}`);
	assert.equal(JSON.stringify(discovery), originalDiscovery, "Fresh result transformation leaves its source untouched");
	assert(!contracts.includes(process.execPath), "Custom command paths are not call contracts");
	const executionContext = { cwd: "/project", executeTool: async (name: string, input: unknown) => {
		assert.equal(name, "tool_search");
		assert.deepEqual(input, query);
		return { toolCall: { type: "toolCall" as const, id: "search", name, arguments: input },
			isError: false, result: { ...discovery, ...complete } };
	} };
	assert.equal(await searchHelper.invoke(query, executionContext, new AbortController().signal), contracts);
	assert.match(String(await searchBridge.getTools([])[0]!.invoke(query, executionContext, new AbortController().signal)),
		/Newly connected bindings: mcp__records__lookup, list_mcp_resources\. Call them in the next exec cell/);
	assert.deepEqual(active, ["exec", resource.name, native.name]);
	codeModeActive = false;
	assert.equal(expand(discovery), undefined, "Native result remains unchanged outside Code/Notebook");
	active = ["exec", resource.name];
	const nativeOnly = await search.execute("native", { query: "sites history notes records", limit: 12 },
		new AbortController().signal, undefined, ctx as never);
	assert.deepEqual((nativeOnly.details as { loaded: string[] }).loaded, [native.name],
		"Nested-only contracts never enter the native search catalogue");
	codeModeActive = true;
	const delegate = new CodeModeDelegateRuntime(() => undefined);
	delegate.bindCell("discovered", { cwd: process.cwd() }, new Map(searchCatalog.map(tool => [tool.name, tool])));
	try {
		const input = JSON.stringify({ resource: "site", action: "get" });
		assert.equal(await delegate.invokeDirect("discovered", 1, sites.name, input), input);
	} finally { delegate.clear(); }
	const invoked: unknown[] = [];
	assert.deepEqual(await mcp.getTools()[0]!.invoke({ id: "record-1" }, {
		cwd: "/project",
		executeTool: async (name: string, input: unknown) => {
			invoked.push({ name, input });
			return { isError: false, result: { content: [], structuredContent: { id: "record-1" } } };
		},
	} as never, new AbortController().signal), { id: "record-1" });
	assert.deepEqual(invoked, [{ name: native.name, input: { id: "record-1" } }]);
	const oldInventory = readToolkitUpdate(inventory.details);
	const legacy = { ...inventory, details: { ...oldInventory,
		tools: [...oldInventory.tools, { name: native.name, description: native.description,
			contract: "prior-contract", namespace: "mcp__records" }],
		namespaces: { mcp__records: "Record lookup" },
	} };
	const legacyBytes = JSON.stringify(legacy);
	assert.equal(recordCodeModeToolkit(pi, ctx, [legacy], catalog), true);
	const migration = messages().at(-1)!;
	assert(migration.role === "custom");
	assert(!String(migration.content).includes(native.name), "Changing discovery does not declare a still-callable MCP tool removed");
	assert.equal(JSON.stringify(legacy), legacyBytes);
	assert.deepEqual(mcp.prepareLoadout({ ...loadout, callable: [extension] } as never).hiddenDeclarations, []);
	assert.deepEqual(mcp.getTools(), []);

	const calls: unknown[] = [];
	const kernel: Record<string, unknown> = {
		fetch: async (_url: string, request: { body: string }) => {
			const payload = JSON.parse(request.body);
			if (payload.kind === "tool") {
				calls.push(payload.toolName);
				return { ok: true, text: async () => JSON.stringify({ ok: true, result: "delivered" }) };
			}
			return { ok: true, text: async () => JSON.stringify({ ok: true }) };
		},
	};
	const bootstrap = new Function("globalThis", "Deno", "setInterval", "clearInterval",
		`return (async () => ${notebookBootstrapSource("http://localhost", "token", "exit", "/project")})()`);
	await bootstrap(kernel, { chdir() {}, ppid: 1, memoryUsage: () => ({ rss: 0 }) }, () => 0, () => {});
	const runtime = kernel["__piNotebook"] as {
		begin(
			id: string,
			tools: unknown[],
			names: Record<string, { name: string }>,
		): Promise<void>;
		end(id: string): void;
	};
	await runtime.begin("first", state.ALL_TOOLS, {
		exec_command: { name: "exec_command" },
		deferred_programmatic_tool: { name: "deferred-programmatic-tool" },
	});
	assert.deepEqual(kernel["ALL_TOOLS"], state.ALL_TOOLS);
	assert.match(JSON.stringify(kernel["ALL_TOOLS"]), /Keep record IDs unchanged/);
	const tools = kernel["tools"] as Record<string, (input: unknown) => Promise<unknown>>;
	assert.deepEqual(Object.keys(tools), ["exec_command", "deferred_programmatic_tool"]);
	assert.equal(await tools["deferred_programmatic_tool"]!({}), "delivered");
	assert.deepEqual(calls, [{ name: "deferred-programmatic-tool" }]);
	runtime.end("first");
	await runtime.begin("second", [], {
		exec_command: { name: "exec_command" },
		write_stdin: { name: "write_stdin" },
	});
	assert.deepEqual(Object.keys(tools), ["exec_command", "write_stdin"]);
	runtime.end("second");
});
