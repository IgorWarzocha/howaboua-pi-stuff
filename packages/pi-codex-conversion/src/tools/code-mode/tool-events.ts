import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { injectCustomToolsPrompt } from "./custom-tool-prompt.js";
import type { SharedCodeModeRuntime } from "./shared-runtime.js";

export function registerCodeModeEvents(
	pi: ExtensionAPI,
	runtime: SharedCodeModeRuntime,
): void {
	pi.on("before_agent_start", (event, ctx) => {
		const activeProviders = runtime.activeProviders(ctx);
		if (activeProviders.length === 0) return undefined;
		const documentationPath = activeProviders.find(
			(provider) => provider.documentationPath,
		)?.documentationPath;
		if (!documentationPath) return undefined;
		const systemPrompt = injectCustomToolsPrompt(
			event.systemPrompt,
			runtime.collectTools(ctx),
			documentationPath,
		);
		return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
	});
	pi.on("tool_result", (event) => {
		if (
			(event.toolName === "exec" || event.toolName === "wait") &&
			event.details &&
			typeof event.details === "object" &&
			"codeMode" in event.details &&
			event.details.codeMode === true &&
			"scriptError" in event.details &&
			typeof event.details.scriptError === "string"
		)
			return { isError: true };
		return undefined;
	});
}
