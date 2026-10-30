import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BrowserRuntime } from "./browser/runtime.js";
import { createBrowserTool as createTool } from "./browser-tool-definition.js";

export function createBrowserTool(
	runtime: BrowserRuntime,
	isGpt = () => false,
) {
	return createTool({ defineTool, Type }, runtime, isGpt);
}
