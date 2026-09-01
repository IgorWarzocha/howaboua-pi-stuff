import { defineTool } from "@earendil-works/pi-coding-agent";
import { BROWSER_ACTIONS } from "./browser/operation.js";
import { type BrowserRequest, parseBrowserRequest } from "./browser/request.js";
import { BrowserRuntime } from "./browser/runtime.js";
import { browserParameters } from "./browser-parameters.js";

interface BrowserToolParams {
	action?: (typeof BROWSER_ACTIONS)[number];
	host?: string;
}

const preparedBrowserRequest = Symbol("preparedBrowserRequest");

interface PreparedBrowserInput {
	[preparedBrowserRequest]: BrowserRequest;
}

export function prepareBrowserCodeModeInput(input: unknown): BrowserToolParams {
	if (typeof input !== "string") {
		throw new Error("browser expects a request string");
	}
	const prepared: BrowserToolParams = {};
	Object.defineProperty(prepared, preparedBrowserRequest, {
		value: parseBrowserRequest(input),
	});
	return prepared;
}

function isPreparedBrowserInput(input: unknown): input is PreparedBrowserInput {
	return (
		typeof input === "object" &&
		input !== null &&
		preparedBrowserRequest in input
	);
}

function browserRequest(input: unknown): BrowserRequest {
	return isPreparedBrowserInput(input)
		? input[preparedBrowserRequest]
		: parseBrowserRequest(input);
}

export function createBrowserTool(runtime: BrowserRuntime) {
	const parameters = browserParameters(runtime.hosts);
	return defineTool({
		name: "browser",
		label: "Browser",
		description:
			"Inspect and control logged-in browser tabs with bounded accessibility content, interactive references, continuations and expert CDP actions.",
		parameters,
		promptSnippet: "Load browser help before first use.",
		promptGuidelines: [
			"browser: Start with tabs, then open one ref_id. Keep element IDs with that page result and follow returned continuation cursors.",
			...(runtime.hosts.length > 0
				? [
						"browser: When the user names a browser host, set host on every call and keep it with refs, screenshots and continuation handles.",
					]
				: []),
			"browser: Ask before unfamiliar low-trust navigation or consequential external actions unless already authorized. Never close the shared browser after a task.",
		],
		async execute(_toolCallId, input, signal, onUpdate) {
			const result = await runtime.execute(browserRequest(input), {
				signal: signal ?? new AbortController().signal,
				onOperation(operation, index, total) {
					onUpdate?.({
						content: [
							{
								type: "text",
								text:
									total === 1
										? `Browser ${operation.action}`
										: `Browser ${operation.action} ${index + 1}/${total}`,
							},
						],
						details: {
							action: operation.action,
							index: index + 1,
							total,
							status: "running",
						},
					});
				},
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
			};
		},
	});
}
