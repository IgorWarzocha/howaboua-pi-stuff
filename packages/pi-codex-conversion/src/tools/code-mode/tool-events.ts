import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildCodeModeToolsPrompt,
	injectCodeModeToolsPrompt,
} from "./custom-tool-prompt.js";
import type { SharedCodeModeRuntime } from "./shared-runtime.js";

export function registerCodeModeEvents(
	pi: ExtensionAPI,
	runtime: SharedCodeModeRuntime,
): void {
	pi.on("session_start", (_event, ctx) => {
		runtime.resetPromptTools(ctx);
	});
	pi.on("model_select", (_event, ctx) => {
		runtime.resetPromptTools(ctx);
	});
	pi.on("before_agent_start", (event, ctx) => {
		const activeProviders = runtime.activeProviders(ctx);
		if (activeProviders.length === 0) return undefined;
		void runtime.prepare(ctx)?.catch(() => undefined);
		const documentationPath = activeProviders.find(
			(provider) => provider.documentationPath,
		)?.documentationPath;
		const promptTools = runtime.collectPromptTools(ctx);
		runtime.setPromptSection(
			buildCodeModeToolsPrompt(
				promptTools,
				documentationPath,
				event.systemPrompt,
			),
		);
		const systemPrompt = injectCodeModeToolsPrompt(
			event.systemPrompt,
			promptTools,
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
