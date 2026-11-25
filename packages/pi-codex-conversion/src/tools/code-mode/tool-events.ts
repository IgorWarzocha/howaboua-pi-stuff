import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { prepareCodeModeToolsPrompt } from "./execution-prompt.js";
import type { SharedCodeModeRuntime } from "../execution/runtime.js";
import type { registerPublicCodeModeTools } from "./public-tools.ts";

export function registerCodeModeEvents(
	pi: ExtensionAPI,
	runtime: SharedCodeModeRuntime,
	preparePublicTools: ReturnType<typeof registerPublicCodeModeTools>,
): void {
	pi.on("session_start", () => {
		runtime.resetPromptTools();
		runtime.clearOpaqueResults();
	});
	pi.on("model_select", () => {
		runtime.resetPromptTools();
		runtime.clearOpaqueResults();
	});
	pi.on("session_shutdown", () => runtime.clearOpaqueResults());
	pi.on("before_agent_start", (event, ctx) => {
		preparePublicTools(ctx, event.systemPromptOptions.toolSnippets);
		const executionKind = runtime.executionKind(ctx);
		const requiredTools =
			executionKind === "ts" ? ["exec", "wait", "notebook"] : ["exec", "wait"];
		const activeProviders = runtime.activeProviders(ctx);
		if (activeProviders.length === 0) return undefined;
		void runtime.prepare(ctx)?.catch(() => undefined);
		const documentationPath = activeProviders.find(
			(provider) => provider.documentationPath,
		)?.documentationPath;
		const promptTools = runtime.collectPromptTools(ctx);
		prepareCodeModeToolsPrompt(
			event.systemPromptOptions,
			promptTools,
			documentationPath,
			() =>
				requiredTools.every((name) =>
					event.systemPromptOptions.selectedTools.includes(name),
				),
			executionKind,
			runtime.heavySystemPromptOverwrite(ctx),
		);
		return undefined;
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
