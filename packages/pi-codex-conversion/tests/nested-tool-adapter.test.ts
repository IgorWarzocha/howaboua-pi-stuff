import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { codeModeWebResult } from "../src/adapter/code-mode/nested-tool-adapter.ts";
import { adaptToolForCodeMode } from "../src/code-mode.ts";
import { CodeModeDelegateRuntime } from "../src/tools/code-mode/delegate-runtime.ts";
import {
	CodeModeNestedRenderStore,
	renderTraceAndOutput,
} from "../src/tools/code-mode/trace-rendering.ts";

test("Code Mode nested tools preserve public results and specialized web values", async () => {
	const rendererStates: unknown[] = [];
	const previousCallComponents: unknown[] = [];
	const renderedInputLengths: number[] = [];
	const renderedDetails: unknown[] = [];
	const renderedErrors: boolean[] = [];
	let lateUpdate!: () => void;
	let forwardedUpdates = 0;
	const adapted = adaptToolForCodeMode({
		name: "structured",
		label: "Structured",
		description: "Return structured state",
		parameters: Type.Object({ value: Type.String() }),
		async execute(_id, params, _signal, onUpdate) {
			lateUpdate = () => onUpdate?.({
				content: [{ type: "text", text: "late" }],
				details: {},
			});
			if (params.value === "throw") throw new Error("tool failed");
			return {
				content: [{ type: "text" as const, text: "Done" }],
				details: { id: 123, inputLength: params.value.length },
				addedToolNames: ["next"],
				terminate: true,
			};
		},
		renderCall(args, _theme, context) {
			rendererStates.push(context.state);
			previousCallComponents.push(context.lastComponent);
			renderedInputLengths.push(args.value.length);
			return context.lastComponent ?? new Text("Structured", 0, 0);
		},
		renderResult(result, _options, _theme, context) {
			renderedDetails.push(result.details);
			renderedErrors.push(context.isError === true);
			return new Text(context.isError ? "Styled failure" : "Done", 0, 0);
		},
	}, { usage: "await tools.structured({ value })" });
	assert.equal(
		await adapted.invoke(
			{ value: "short" },
			{
				cwd: process.cwd(),
				extensionContext: {} as ExtensionContext,
				onUpdate: () => { forwardedUpdates += 1; },
			},
			new AbortController().signal,
		),
		"Done",
	);
	lateUpdate();
	assert.equal(forwardedUpdates, 0);
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
	for (let index = 0; index < 2; index += 1) {
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
	}
	assert.equal(rendererStates[0], rendererStates[1]);
	assert.equal(previousCallComponents[0], undefined);
	assert.ok(previousCallComponents[1] instanceof Text);
	assert.deepEqual(renderedInputLengths, [longValue.length, longValue.length]);
	assert.deepEqual(renderedDetails, [
		{ id: 123, inputLength: longValue.length },
		{ id: 123, inputLength: longValue.length },
	]);
	assert.deepEqual(renderedErrors, [false, false]);
	runtime.bindCell(
		"cell-error",
		{ cwd: process.cwd(), extensionContext: {} as ExtensionContext },
		new Map([[adapted.name, adapted]]),
	);
	await assert.rejects(
		runtime.invokeDirect("cell-error", 2, adapted.name, { value: "throw" }),
		/tool failed/,
	);
	const failed = runtime.attach({
		kind: "result",
		cellId: "cell-error",
		contentItems: [],
	}).traces?.[0];
	assert.ok(failed);
	const styledFailure = renderTraceAndOutput(
		[failed],
		0,
		[adapted],
		new Container(),
		false,
		{ expanded: true, isPartial: false },
		theme,
		{ cwd: process.cwd(), showImages: true },
		new Map(),
		renderStore,
	).render(80).join("\n");
	assert.match(styledFailure, /Styled failure/);
	assert.doesNotMatch(styledFailure, /tool failed/);
	assert.equal(renderedErrors.at(-1), true);
	const { renderCall: _renderCall, ...adaptedWithoutCallRenderer } = adapted;
	const fallback = renderTraceAndOutput(
		[trace],
		0,
		[{
			...adaptedWithoutCallRenderer,
			renderResult() {
				throw new Error("broken extension renderer");
			},
		}],
		new Container(),
		false,
		{ expanded: true, isPartial: false },
		theme,
		{ cwd: process.cwd(), showImages: true },
		new Map(),
		new CodeModeNestedRenderStore(),
	);
	assert.match(fallback.render(80).join("\n"), /Done/);
	const firstRenderState = renderStore.get("trace-1");
	for (let index = 0; index < 512; index += 1)
		renderStore.get(`later-trace-${index}`);
	assert.notEqual(renderStore.get("trace-1"), firstRenderState);

	const webRun = {
		output: "Search summary with internal refs",
		search_results: [
			{ title: "Example", url: "https://example.com/source" },
		],
	};

	assert.deepEqual(codeModeWebResult({
		content: [{ type: "text", text: webRun.output }],
		details: { webRun },
	}), webRun);
});
