import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexExtensionRuntime } from "../extension/runtime.ts";
import {
	type CodeModeRegistration,
	registerCodeModeTools,
	registerCustomTools,
} from "../tools/code-mode/tools.ts";
import type { ProgrammaticCodeModeToolDefinition } from "../tools/code-mode/types.ts";
import { createApplyPatchTool } from "../tools/apply-patch/tool.ts";
import { createExecCommandTool } from "../tools/exec/command-tool.ts";
import { createWriteStdinTool } from "../tools/exec/write-stdin-tool.ts";
import { createImageGenerationTool, supportsNativeImageGeneration } from "../tools/imagegen/tool.ts";
import { createViewImageTool, supportsViewImageInputs } from "../tools/view-image/tool.ts";
import { createWebSearchTool } from "../tools/web-run/tool.ts";
import { shouldUseGpt56CodeMode } from "./activation/activation.ts";
import { codeModeImageResult, toNestedTool } from "./code-mode/nested-tool-adapter.ts";

export const CODE_MODE_TOOL_NAMES = ["exec", "wait"] as const;

export async function registerCodexCodeMode(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
): Promise<CodeModeRegistration> {
	const isActive = (ctx: unknown) =>
		shouldUseGpt56CodeMode(ctx as ExtensionContext, runtime.state.config);
	const customToolsRuntime = await registerCustomTools(pi, undefined, {
		isActive,
	});
	const programmaticRuntime = await registerCodeModeTools(pi, {
		getTools: (ctx) => createNestedTools(runtime, ctx as ExtensionContext | undefined),
		isActive,
		providesRenderers: true,
		richRendering: () => runtime.state.config.ui.codeModeDetails,
	});
	return {
		prepare: (ctx) => programmaticRuntime.prepare(ctx),
		shutdownHost: () => programmaticRuntime.shutdownHost(),
		async shutdown() {
			await programmaticRuntime.shutdown();
			await customToolsRuntime.shutdown();
		},
	};
}

function createNestedTools(
	runtime: CodexExtensionRuntime,
	ctx?: ExtensionContext,
): ProgrammaticCodeModeToolDefinition[] {
	const options = {
		describeImagesForTextModels: runtime.state.config.tools.viewImageFallback,
		promptSnippet: false,
		customRendering: runtime.state.config.ui.toolRenaming,
		showOutputWhenCollapsed: true,
		compactTools: runtime.state.config.ui.compactTools,
	};
	const tools: ProgrammaticCodeModeToolDefinition[] = [
		toNestedTool(
			createApplyPatchTool({
				promptSnippet: false,
				showDiffWhenCollapsed: !runtime.state.config.ui.compactTools,
			}),
			"await tools.apply_patch(patch)",
			{},
			{
				kind: "freeform",
				prepareInput(input) {
					if (typeof input !== "string")
						throw new Error("apply_patch expects a patch string");
					return { input };
				},
				resultError(result) {
					if (
						result.details &&
						typeof result.details === "object" &&
						"status" in result.details &&
						result.details.status === "partial_failure"
					)
						return result.content
							.filter((item) => item.type === "text")
							.map((item) => item.text)
							.join("\n") || "apply_patch partially failed";
					return undefined;
				},
			},
		),
		toNestedTool(
			createExecCommandTool(runtime.tracker, runtime.sessions, options),
			"await tools.exec_command({ cmd: string, workdir?: string, shell?: string, tty?: boolean, yield_time_ms?: number, max_output_tokens?: number, login?: boolean })",
			{
				start(id, input) {
					const cmd =
						input &&
						typeof input === "object" &&
						"cmd" in input &&
						typeof input.cmd === "string"
							? input.cmd
							: "";
					if (cmd) runtime.tracker.recordStart(id, cmd);
				},
				end: (id) => runtime.tracker.recordEnd(id),
			},
		),
		toNestedTool(
			createWriteStdinTool(runtime.sessions, options),
			"await tools.write_stdin({ session_id: number, chars?: string, yield_time_ms?: number, max_output_tokens?: number })",
		),
	];
	if (!ctx || supportsViewImageInputs(ctx.model) || runtime.state.config.tools.viewImageFallback) {
		const imageCapable = !ctx || supportsViewImageInputs(ctx.model);
		tools.push(toNestedTool(
			createViewImageTool({
				describeForTextModels: runtime.state.config.tools.viewImageFallback,
				promptSnippet: false,
				customRendering: runtime.state.config.ui.toolRenaming,
			}),
			imageCapable
				? "const result = await tools.view_image({ path: string, detail?: \"original\" }); image(result)"
				: "const description = await tools.view_image({ path: string }); text(description)",
			{},
			{ ...(imageCapable ? { resultValue: codeModeImageResult } : {}) },
		));
	}
	if (runtime.state.config.tools.webRun) {
		tools.push(toNestedTool(
			createWebSearchTool("web__run", {
				getRecentInput: () => runtime.latestRecentWebSearchInput,
				model: () => runtime.state.config.openai.webSearchModel,
				promptSnippet: false,
				customRendering: runtime.state.config.ui.toolRenaming,
			}),
			"await tools.web__run({ search_query?: [{ q: string, recency?: number, domains?: string[] }], image_query?: [{ q: string }], open?: [{ ref_id: string, lineno?: number }], click?: [{ ref_id: string, id: number }], find?: [{ ref_id: string, pattern: string }], response_length?: \"short\" | \"medium\" | \"long\" })",
		));
	}
	if (runtime.state.config.tools.imageGeneration && (!ctx || supportsNativeImageGeneration(ctx.model))) {
		const imagegen = createImageGenerationTool({
			promptSnippet: false,
			customRendering: runtime.state.config.ui.toolRenaming,
		});
		tools.push(toNestedTool(
			{ ...imagegen, name: "image_gen__imagegen", label: "image_gen__imagegen" },
			"await tools.image_gen__imagegen({ prompt: string, action?: \"generate\" | \"edit\", images?: string[] })",
			{},
			{
				resultValue(result) {
					const outputHint = result.content
						.filter((item) => item.type === "text")
						.map((item) => item.text)
						.join("\n") || undefined;
					return codeModeImageResult(result, outputHint);
				},
			},
		));
	}
	return tools;
}
