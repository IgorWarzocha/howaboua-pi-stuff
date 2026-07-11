import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { WEB_SEARCH_TOOL_NAME } from "../adapter/activation/tool-set.ts";
import { registerApplyPatchTool } from "../tools/apply-patch/tool.ts";
import { registerExecCommandTool } from "../tools/exec/command-tool.ts";
import { registerWriteStdinTool } from "../tools/exec/write-stdin-tool.ts";
import { registerImageGenerationTool } from "../tools/imagegen/tool.ts";
import { registerViewImageTool } from "../tools/view-image/tool.ts";
import { registerWebSearchTool } from "../tools/web-run/tool.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";

export interface CodexToolRegistration {
	applyConfig(config: CodexConversionConfig): void;
	ensureOptionalTools(config?: CodexConversionConfig): void;
}

export function registerCodexTools(pi: ExtensionAPI, runtime: CodexExtensionRuntime): CodexToolRegistration {
	const renderOptions = (config: CodexConversionConfig) => ({ customRendering: config.ui.toolRenaming });
	const promptOptions = (config: CodexConversionConfig) => ({ promptSnippet: config.mode === "path" });
	const registerCore = (config: CodexConversionConfig) => {
		registerApplyPatchTool(pi, { ...promptOptions(config), showDiffWhenCollapsed: config.mode === "normal" && !config.ui.compactTools });
		registerExecCommandTool(pi, runtime.tracker, runtime.sessions, {
			describeImagesForTextModels: config.tools.viewImageFallback,
			...renderOptions(config),
			...promptOptions(config),
			showOutputWhenCollapsed: config.mode === "normal",
			compactTools: config.ui.compactTools,
		});
		registerWriteStdinTool(pi, runtime.sessions, { describeImagesForTextModels: config.tools.viewImageFallback, ...promptOptions(config) });
		registerViewImageTool(pi, { describeForTextModels: config.tools.viewImageFallback, ...renderOptions(config), ...promptOptions(config) });
	};
	const ensureOptionalTools = (config = runtime.state.config) => {
		const allowConfiguredProvider = (model: Model<Api> | undefined): boolean => {
			if (config.scope.allProviders !== "off") return true;
			const provider = model?.provider?.trim().toLowerCase();
			return Boolean(provider && config.scope.additionalProviders.includes(provider));
		};
		if (config.tools.webRun || config.tools.webRunOnly) {
			registerWebSearchTool(pi, WEB_SEARCH_TOOL_NAME, {
				getRecentInput: () => runtime.latestRecentWebSearchInput,
				model: () => runtime.state.config.openai.webSearchModel,
				allowConfiguredProvider,
				...renderOptions(config),
				...promptOptions(config),
			});
			runtime.registeredNativeWebSearchTools.add(WEB_SEARCH_TOOL_NAME);
		}
		if (config.tools.imageGeneration || config.tools.imageGenerationOnly) {
			registerImageGenerationTool(pi, { allowConfiguredProvider, ...renderOptions(config), ...promptOptions(config) });
		}
	};
	registerCore(runtime.state.config);
	ensureOptionalTools();
	return {
		ensureOptionalTools,
		applyConfig(config) {
			registerCore(config);
			ensureOptionalTools(config);
			runtime.sessions.setBaseEnv(runtime.bundledPathToolsEnv(config));
		},
	};
}
