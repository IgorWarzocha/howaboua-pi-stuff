import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isRecordValue } from "./browser/parse-operation.js";
import { parseBrowserRequest } from "./browser/request.js";
import { BrowserRuntime } from "./browser/runtime.js";

export function prepareBrowserInput(input: unknown): { command: string } {
	if (typeof input === "string") return { command: input };
	if (!isRecordValue(input)) {
		throw new Error("browser input must be a command envelope or JSON request");
	}
	if (Object.hasOwn(input, "command")) {
		if (typeof input["command"] !== "string") {
			throw new Error(
				'browser command must be "help" or a JSON request string',
			);
		}
		return { ...input, command: input["command"] };
	}
	// Resume old object calls without changing their stored history representation.
	return { command: JSON.stringify(input) };
}

export function createBrowserTool(runtime: BrowserRuntime) {
	return defineTool({
		name: "browser",
		label: "Browser",
		description: "Control logged-in browser; call help before other actions",
		parameters: Type.Object(
			{ command: Type.String({ description: "help or JSON request" }) },
			{ additionalProperties: false },
		),
		prepareArguments: prepareBrowserInput,
		async execute(_toolCallId, input, signal, onUpdate, ctx) {
			const result = await runtime.execute(parseBrowserRequest(input.command), {
				ownerId: ctx.sessionManager.getSessionId(),
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
