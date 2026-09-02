import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { adaptToolForCodeMode } from "../src/code-mode.ts";
import { CodeModeDelegateRuntime } from "../src/tools/code-mode/delegate-runtime.ts";
import {
	CodeModeNestedRenderStore,
	renderTraceAndOutput,
} from "../src/tools/code-mode/trace-rendering.ts";

test("Code Mode nested tools preserve public and namespaced extension results", async () => {
	const renderedInputLengths: number[] = [];
	const adapted = adaptToolForCodeMode({
		name: "structured",
		label: "Structured",
		description: "Return structured state",
		parameters: Type.Object({ value: Type.String() }),
		async execute(_id, params) {
			return {
				content: [{ type: "text" as const, text: "Done" }],
				details: { id: 123, inputLength: params.value.length },
				addedToolNames: ["next"],
				terminate: true,
			};
		},
		renderCall(args, _theme, context) {
			renderedInputLengths.push(args.value.length);
			return context.lastComponent ?? new Text("Structured", 0, 0);
		},
		renderResult() {
			return new Text("Done", 0, 0);
		},
	}, { usage: "await tools.structured({ value })" });
	const namespaced = adaptToolForCodeMode(
		{
			...adaptedTool(),
			name: "external",
		},
		{
			usage: "await tools.media__external({ value })",
			toolName: { namespace: "media", name: "external" },
			resultValue: (result) => result.details,
		},
	);
	assert.equal(namespaced.name, "media__external");
	assert.equal(namespaced.topLevelName, "external");
	assert.deepEqual(namespaced.toolName, { namespace: "media", name: "external" });
	assert.deepEqual(
		await namespaced.invoke(
			{ value: "mapped" },
			{ cwd: process.cwd(), extensionContext: {} as ExtensionContext },
			new AbortController().signal,
		),
		{ value: "mapped" },
	);
	const freeform = adaptToolForCodeMode(
		{
			name: "routed",
			label: "Routed",
			description: "One routed string",
			parameters: Type.Object({ request: Type.String() }),
			async execute(_id, params) {
				return {
					content: [{ type: "text" as const, text: params.request }],
					details: {},
				};
			},
		},
		{
			kind: "freeform",
			prepareInput: (input) => ({ request: input }),
			usage: 'await tools.routed("help")',
		},
	);
	assert.equal(freeform.kind, "freeform");
	assert.equal("inputSchema" in freeform, false);
	assert.equal(
		await freeform.invoke(
			"help",
			{ cwd: process.cwd(), extensionContext: {} as ExtensionContext },
			new AbortController().signal,
		),
		"help",
	);
	assert.throws(
		() =>
			adaptToolForCodeMode(
				{
					name: "invalid_freeform",
					label: "Invalid freeform",
					description: "Missing input projection",
					parameters: Type.Object({ request: Type.String() }),
					async execute() {
						return {
							content: [{ type: "text" as const, text: "unused" }],
							details: {},
						};
					},
				},
				{ kind: "freeform", usage: "await tools.invalid_freeform(input)" },
			),
		/require prepareInput/i,
	);
	const renderStore = new CodeModeNestedRenderStore();
	const runtime = new CodeModeDelegateRuntime(() => undefined, renderStore);
	runtime.bindCell(
		"cell-a",
		{ cwd: process.cwd(), extensionContext: {} as ExtensionContext },
		new Map([[adapted.name, adapted]]),
	);
	const longValue = "x".repeat(20_000);
	await runtime.invokeDirect("cell-a", 1, adapted.name, { value: longValue });
	const attached = runtime.attach({
		kind: "result",
		cellId: "cell-a",
		contentItems: [],
	});
	const trace = attached.traces?.[0];
	assert.ok(trace);
	assert.notEqual((trace.input as { value: string }).value.length, longValue.length);
	const theme = {
		fg: (_role: string, text: string) => text,
		bold: (text: string) => text,
	};
	renderTraceAndOutput(
		[trace],
		0,
		[adapted],
		new Container(),
		false,
		{ expanded: false, isPartial: false },
		theme,
		{ cwd: process.cwd(), showImages: true },
		new Map(),
		renderStore,
	);
	assert.deepEqual(renderedInputLengths, [longValue.length]);
	const byteBoundedStore = new CodeModeNestedRenderStore(128);
	const oversizedState = byteBoundedStore.get("oversized");
	byteBoundedStore.captureResult("oversized", {
		content: [
			{
				type: "image",
				data: "x".repeat(256),
				mimeType: "image/png",
			},
		],
	});
	assert.notEqual(byteBoundedStore.get("oversized"), oversizedState);
});

function adaptedTool() {
	return {
		name: "external",
		label: "External",
		description: "External extension tool",
		parameters: Type.Object({ value: Type.String() }),
		async execute(_id: string, params: { value: string }) {
			return {
				content: [{ type: "text" as const, text: params.value }],
				details: { value: params.value },
			};
		},
	};
}
