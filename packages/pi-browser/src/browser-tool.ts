import { defineTool } from "@earendil-works/pi-coding-agent";
import { obj, opt, str } from "@earendil-works/pi-schema";
import type { BrowserRuntime } from "./browser/runtime.js";
import { createBrowserTool as createTool } from "./browser-tool-definition.js";

export function createBrowserTool(
	runtime: BrowserRuntime,
	isGpt = () => false,
) {
	return createTool({ defineTool, obj, opt, str }, runtime, isGpt);
}
