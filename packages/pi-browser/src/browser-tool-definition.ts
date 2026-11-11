import type { defineTool as definePiTool } from "@earendil-works/pi-coding-agent";
import type {
	Static,
	obj as schemaObj,
	opt as schemaOpt,
	str as schemaStr,
} from "@earendil-works/pi-schema";
import { browserHelp } from "./browser/help.js";
import { isRecordValue } from "./browser/parse-operation.js";
import { parseBrowserRequest } from "./browser/request.js";
import type { BrowserRuntime } from "./browser/runtime.js";

export function prepareBrowserInput(input: unknown): { command: string } {
	if (input === undefined) return { command: "help" };
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
	parseBrowserRequest(input);
	return { command: JSON.stringify(input) };
}

export function createBrowserTool(
	{
		defineTool,
		obj,
		opt,
		str,
	}: {
		defineTool: typeof definePiTool;
		obj: typeof schemaObj;
		opt: typeof schemaOpt;
		str: typeof schemaStr;
	},
	runtime: BrowserRuntime,
	isGpt = () => false,
) {
	const parameters = obj(
		{
			command: opt(str({ description: "help or JSON request" })),
		},
		{ open: false },
	);
	return defineTool({
		name: "browser",
		label: "Browser",
		description: "Control logged-in browser",
		parameters,
		prepareArguments: prepareBrowserInput,
		async execute(
			_toolCallId,
			input: Static<typeof parameters>,
			signal,
			onUpdate,
			ctx,
		) {
			const request = parseBrowserRequest(input.command);
			let result = await runtime.execute(request, {
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
			if (isGpt() && "help" in request)
				result = browserHelp(runtime.hosts, true);
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
			};
		},
	});
}
