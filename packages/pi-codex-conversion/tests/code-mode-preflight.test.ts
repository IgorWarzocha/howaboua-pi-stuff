import assert from "node:assert/strict";
import test from "node:test";
import {
	createEventBus,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CodeModeDelegateRuntime } from "../src/tools/code-mode/delegate-runtime.ts";
import {
	registerCodeModeToolPreflight,
} from "../src/code-mode-preflight.ts";
import { registerCodeModePreflightBroker } from "../src/tools/code-mode/nested-tool-preflight.ts";
import type {
	CodeModeToolDefinition,
	ProgrammaticCodeModeToolDefinition,
	ToolExecutionContext,
} from "../src/tools/code-mode/types.ts";

function extensionApi(bus = createEventBus()) {
	const shutdownHandlers: Array<() => void | Promise<void>> = [];
	const tools = new Map<string, unknown>();
	const pi = {
		events: {
			emit: bus.emit,
			on: bus.on,
		},
		on(event: string, handler: () => void | Promise<void>) {
			if (event === "session_shutdown") shutdownHandlers.push(handler);
		},
		registerTool(tool: { name: string }) {
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		tools,
		async shutdown() {
			for (const handler of shutdownHandlers) await handler();
		},
	};
}

test("Code Mode preflight broker survives extension load order and reload", async () => {
	const bus = createEventBus();
	const guardApi = extensionApi(bus);
	let calls = 0;
	let block = false;
	let captureInput = false;
	let firstInput: unknown;
	const registration = registerCodeModeToolPreflight(guardApi.pi, (call) => {
		calls += 1;
		if (captureInput) {
			firstInput = call.input;
			assert.throws(() => {
				(call.input as { cmd: string }).cmd = "mutated";
			});
		}
		return block ? { block: true, reason: "Approval is required" } : undefined;
	});
	assert.equal(registration.available, false);

	const firstCodeModeApi = extensionApi(bus);
	const firstBroker = registerCodeModePreflightBroker(firstCodeModeApi.pi);
	assert.equal(registration.available, true);
	await firstBroker.run({
		toolName: "exec_command",
		input: { cmd: "pwd" },
		toolCallId: "nested-1",
		cwd: "/tmp",
		extensionContext: {} as ExtensionContext,
		signal: new AbortController().signal,
	});
	assert.equal(calls, 1);

	await firstCodeModeApi.shutdown();
	assert.equal(registration.available, false);
	const reloadedCodeModeApi = extensionApi(bus);
	const reloadedBroker = registerCodeModePreflightBroker(reloadedCodeModeApi.pi);
	assert.equal(registration.available, true);
	block = true;
	await assert.rejects(reloadedBroker.run({
		toolName: "exec_command",
		input: { cmd: "rm -rf target" },
		toolCallId: "nested-blocked",
		cwd: "/tmp",
		extensionContext: {} as ExtensionContext,
		signal: new AbortController().signal,
	}), /Approval is required/);
	block = false;

	const lateGuardApi = extensionApi(bus);
	let lateInput: unknown;
	const lateRegistration = registerCodeModeToolPreflight(lateGuardApi.pi, (call) => {
		calls += 10;
		lateInput = call.input;
	});
	assert.equal(lateRegistration.available, true);
	const approvedInput = { cmd: "pwd" };
	captureInput = true;
	await reloadedBroker.run({
		toolName: "exec_command",
		input: approvedInput,
		toolCallId: "nested-2",
		cwd: "/tmp",
		extensionContext: {} as ExtensionContext,
		signal: new AbortController().signal,
	});
	assert.equal(calls, 13);
	assert.deepEqual(firstInput, approvedInput);
	assert.deepEqual(lateInput, approvedInput);
	assert.notEqual(firstInput, lateInput);
});

test("nested preflight blocks or cancels tools before invocation", async () => {
	const waiters: Array<(value: unknown) => void> = [];
	const runtime = new CodeModeDelegateRuntime((message) => {
		waiters.shift()?.(message);
	});
	let programmaticInvoked = false;
	const programmatic: ProgrammaticCodeModeToolDefinition = {
		name: "exec_command",
		usage: "await tools.exec_command({ cmd })",
		deferLoading: false,
		kind: "function",
		inputSchema: { type: "object" },
		async invoke() {
			programmaticInvoked = true;
		},
	};
	const toml: CodeModeToolDefinition = {
		name: "custom_shell",
		usage: "await tools.custom_shell(input)",
		deferLoading: false,
		command: process.execPath,
		args: ["-e", "process.exitCode = 99"],
		input: "arg",
		sourcePath: "/tmp/custom_shell.toml",
	};
	let preflightCalls = 0;
	const context: ToolExecutionContext = {
		cwd: process.cwd(),
		extensionContext: {} as ExtensionContext,
		preflight: async () => {
			preflightCalls += 1;
			throw new Error(
				preflightCalls === 1 ? "Approval is required" : "Guard failed closed",
			);
		},
	};

	async function invoke(cellId: string, id: number, tool: CodeModeToolDefinition, input: unknown) {
		runtime.bindCell(cellId, context, new Map([[tool.name, tool]]));
		const response = new Promise((resolve) => waiters.push(resolve));
		runtime.handleRequest({
			id,
			request: {
				type: "tool/invoke",
				invocation: {
					cell_id: cellId,
					input,
					runtime_tool_call_id: `nested-${id}`,
					tool_name: { name: tool.name },
				},
			},
		});
		return await response;
	}

	const programmaticResponsePromise = invoke("cell-1", 1, programmatic, { cmd: "pwd" });
	const programmaticResponse = await programmaticResponsePromise;
	assert.equal(programmaticInvoked, false);
	assert.deepEqual(programmaticResponse, {
		type: "delegate/response",
		id: 1,
		result: { status: "error", message: "Approval is required" },
	});

	const tomlResponse = await invoke("cell-2", 2, toml, "input");
	assert.deepEqual(tomlResponse, {
		type: "delegate/response",
		id: 2,
		result: { status: "error", message: "Guard failed closed" },
	});

	context.preflight = async () => {
		await Promise.resolve();
		runtime.cancel(3);
	};
	const cancelledResponse = await invoke("cell-3", 3, programmatic, { cmd: "pwd" });
	assert.equal(
		(cancelledResponse as { result: { status: string } }).result.status,
		"error",
	);
	assert.equal(programmaticInvoked, false);
});
