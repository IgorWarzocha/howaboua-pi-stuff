import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { registerApplyPatchResultEvent } from "../src/index.ts";
import { toCodeModeToolResult } from "../src/tools/code-mode/tool-result.ts";
import { CodeModeDelegateRuntime } from "../src/tools/code-mode/delegate-runtime.ts";
import { createMcpCodeModeBridge } from "../src/adapter/code-mode/mcp-tools.ts";
import { withMissingMcpToolRecovery } from "../src/tools/code-mode/mcp-tool-recovery.ts";

test("apply_patch partial mutations remain error results", () => {
	let handler: ((event: { toolName: string; details: unknown }) => unknown) | undefined;
	registerApplyPatchResultEvent({
		on(event: string, registered: (...args: never[]) => unknown) {
			if (event === "tool_result") handler = registered as typeof handler;
		},
	} as never);
	const result = {
		changedFiles: [],
		createdFiles: [],
		deletedFiles: [],
		movedFiles: [],
		fuzz: 0,
	};

	assert.deepEqual(handler?.({
		toolName: "apply_patch",
		details: { status: "partial_failure", result },
	}), { isError: true });
	assert.equal(handler?.({ toolName: "apply_patch", details: { status: "success", result } }), undefined);
});

test("Code, Notebook and custom-tool results retain output and recovery without success boilerplate", async () => {
	const completed = toCodeModeToolResult({
		kind: "result", cellId: "complete",
		contentItems: [{ type: "input_text", text: "Script completed" }],
	});
	assert.deepEqual(completed.content, [{ type: "text", text: "Script completed" }]);
	const empty = toCodeModeToolResult({ kind: "result", cellId: "empty", contentItems: [] });
	assert.deepEqual(empty.content, [{ type: "text", text: "OK" }]);
	const result = toCodeModeToolResult({
		kind: "yielded",
		cellId: "notebook-1",
		contentItems: [],
		notebookMemory: {
			heapUsedBytes: 950,
			heapTotalBytes: 960,
			rssBytes: 1_200,
			externalBytes: 10,
			heapLimitBytes: 1_000,
		},
	});
	const text = result.content.map((item) => item.type === "text" ? item.text : "").join("\n");
	assert.match(text, /Notebook memory:/);
	assert.match(text, /CRITICAL:/);

	const failed = toCodeModeToolResult({
		kind: "result",
		cellId: "notebook-2",
		contentItems: [],
		errorText: "SyntaxError: Identifier 'patch' has already been declared",
	});
	assert.match(
		failed.content.map((item) => item.type === "text" ? item.text : "").join("\n"),
		/retry one-off code inside \{ \.\.\. \}/,
	);
	const delegate = new CodeModeDelegateRuntime(() => undefined);
	delegate.bindCell("missing", { cwd: process.cwd() }, new Map());
	try {
		await assert.rejects(delegate.invokeDirect("missing", 1, "mcp__records__missing", {}), (error: Error) => {
			assert.match(error.message, /mcp__records/);
			assert.match(error.message, /If that server connects, retry in a new exec cell/);
			assert.match(error.message, /If failures repeat, suggest disabling that specific server to the user/);
			return true;
		});
		await assert.rejects(delegate.invokeDirect("missing", 2, "ordinary_missing", {}), {
			message: "Unknown custom tool: ordinary_missing",
		});
		const native = { name: "mcp__records_store__read", description: "Read", parameters: { type: "object" } };
		const bridge = createMcpCodeModeBridge({ getAllTools: () => [{ ...native, sourceInfo: { path: "builtin:mcp" } }] } as never);
		bridge.prepareLoadout({ callable: [native], getExposure: () => "codemode" as const, getNamespace: () => ({ name: "mcp__records.store" }) } as never);
		const tools = bridge.getTools();
		delegate.bindCell("missing", { cwd: process.cwd() }, new Map(tools.map((tool) => [tool.name, tool])));
		const known = /MCP namespace "mcp__records\.store"\. If that server connects/;
		await assert.rejects(delegate.invokeDirect("missing", 3, "mcp__records_store__missing", {}), known);
		const captured: unknown[] = [];
		const missingOutcome = { result: { content: [{ type: "text" as const, text: `Tool ${native.name} not found` }], details: {} }, isError: true };
		await assert.rejects(tools[0]!.invoke({}, {
			cwd: process.cwd(),
			executeTool: async () => missingOutcome as never,
			captureResult: (result) => captured.push(result),
		}, new AbortController().signal), known);
		assert.match(JSON.stringify(captured), /suggest disabling that specific server/);
		await assert.rejects(tools[0]!.invoke({}, {
			cwd: process.cwd(),
			executeTool: async () => ({ ...missingOutcome, result: { ...missingOutcome.result, content: [{ type: "text", text: "Permission denied" }] } }) as never,
		}, new AbortController().signal), { message: "Permission denied" });
		const serverPayload = { content: [{ type: "text", text: `Tool ${native.name} not found` }], isError: true };
		assert.equal(await tools[0]!.invoke({}, {
			cwd: process.cwd(),
			executeTool: async () => ({ ...missingOutcome, result: { ...missingOutcome.result, structuredContent: serverPayload } }) as never,
		}, new AbortController().signal), serverPayload);

		// Exercise the injected V8 boundary: missing properties never reach delegation.
		const sandbox = { tools: { ordinary: () => { throw new Error("ordinary failure"); } } };
		Function("globalThis", withMissingMcpToolRecovery("", tools))(sandbox);
		const proxy = sandbox.tools as Record<string, () => void>;
		assert.throws(() => proxy["mcp__records_store__missing"]!(), known);
		assert.equal(proxy["ordinary_missing"], undefined);
		assert.throws(() => proxy["ordinary"]!(), { message: "ordinary failure" });
		assert.deepEqual(Object.keys(proxy), ["ordinary"]);
		const ambiguousTools = [...tools, { ...tools[0]!, name: "mcp__records_store__other", namespace: { name: "mcp__records_store" } }];
		delegate.bindCell("ambiguous", { cwd: process.cwd() }, new Map(ambiguousTools.map((tool) => [tool.name, tool])));
		const ambiguity = /Ambiguous MCP namespace \["mcp__records\.store","mcp__records_store"\]; confirm the server/;
		await assert.rejects(delegate.invokeDirect("ambiguous", 4, "mcp__records_store__missing", {}), ambiguity);
		const ambiguousSandbox = { tools: {} };
		Function("globalThis", withMissingMcpToolRecovery("", ambiguousTools))(ambiguousSandbox);
		assert.throws(() => (ambiguousSandbox.tools as Record<string, () => void>)["mcp__records_store__missing"]!(), ambiguity);
	} finally { delegate.clear(); }

	// The command-backed example runs outside the TypeScript tool registry.
	const sitesClient = new URL("../examples/custom-tools/sites/client.mjs", import.meta.url).href;
	const sitesOperations = new URL("../examples/custom-tools/sites/operations.mjs", import.meta.url).href;
	execFileSync(process.execPath, ["--input-type=module", "-e", `
		import assert from "node:assert/strict";
		import { SitesClient } from ${JSON.stringify(sitesClient)};
		import { resolveOperation } from ${JSON.stringify(sitesOperations)};
		for (const [resource, action] of [["site", "constructor"], ["__proto__", "get"]]) {
			assert.throws(() => resolveOperation(resource, action), { code: "unknown_operation" });
		}
		const error = { code: "site_not_owner_only", saved_version_id: "saved-opaque-id" };
		for (const payload of [
			{ result: { isError: true, structuredContent: { error } } },
			{ result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error }) }] } },
			{ error: { code: -32603, data: error } },
		]) {
			const client = new SitesClient({ fetchImpl: async () => Response.json(payload) });
			client.headers = {};
			client.tools = [{ name: "sites_save_version_and_deploy_private" }];
			await assert.rejects(client.call("save_version_and_deploy_private", {}), (failure) => {
				assert.equal(failure.code, "site_not_owner_only");
				assert.deepEqual(failure.details, { saved_version_id: "saved-opaque-id" });
				assert.equal(failure.topic, "deployment");
				return true;
			});
		}
	`], { encoding: "utf8", timeout: 10_000 });
});
