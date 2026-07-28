import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { WEB_SEARCH_TOOL_NAME } from "../adapter/activation/tool-set.ts";
import { registerApplyPatchResultEvent, registerApplyPatchTool } from "../tools/apply-patch/tool.ts";
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

export function isExplicitlyConfiguredToolProvider(model: Model<Api> | undefined, config: CodexConversionConfig): boolean {
	const provider = model?.provider?.trim().toLowerCase();
	return Boolean(provider && config.scope.additionalProviders.some((entry) => entry.trim().toLowerCase() === provider));
}

export function registerCodexTools(pi: ExtensionAPI, runtime: CodexExtensionRuntime): CodexToolRegistration {
	registerApplyPatchResultEvent(pi);
	const renderOptions = (config: CodexConversionConfig) => ({ customRendering: config.ui.toolRenaming });
	const promptOptions = (config: CodexConversionConfig) => ({ promptSnippet: config.mode === "path" });
	const registerApplyPatch = (config: CodexConversionConfig) =>
		registerApplyPatchTool(pi, { customRustBinariesDir: config.tools.customRustBinariesDir, ...promptOptions(config), showDiffWhenCollapsed: config.mode === "normal" && !config.ui.compactTools });
	const registerViewImage = (config: CodexConversionConfig) =>
		registerViewImageTool(pi, { customRustBinariesDir: config.tools.customRustBinariesDir, describeForTextModels: config.tools.viewImageFallback, ...renderOptions(config), ...promptOptions(config) });
	const registerCore = (config: CodexConversionConfig) => {
		registerApplyPatch(config);
		registerExecCommandTool(pi, runtime.tracker, runtime.sessions, {
			describeImagesForTextModels: config.tools.viewImageFallback,
			...renderOptions(config),
			...promptOptions(config),
			showOutputWhenCollapsed: config.mode === "normal",
			compactTools: config.ui.compactTools,
		});
		registerWriteStdinTool(pi, runtime.sessions, { describeImagesForTextModels: config.tools.viewImageFallback, ...promptOptions(config) });
		registerViewImage(config);
	};
	const ensureOptionalTools = (config = runtime.state.config) => {
		if (config.voiceFeaturesOnly) {
			if (config.tools.applyPatchOnly) registerApplyPatch(config);
			if (config.tools.viewImageOnly) registerViewImage(config);
		}
		const allowConfiguredProvider = (model: Model<Api> | undefined): boolean =>
			isExplicitlyConfiguredToolProvider(model, config);
		const allowCodexProviderFallback = config.scope.allProviders !== "off";
		if ((!config.voiceFeaturesOnly && config.tools.webRun) || config.tools.webRunOnly) {
			registerWebSearchTool(pi, WEB_SEARCH_TOOL_NAME, {
				customRustBinariesDir: config.tools.customRustBinariesDir,
				model: () => runtime.state.config.openai.webSearchModel,
				allowConfiguredProvider,
				allowCodexProviderFallback,
				...renderOptions(config),
				...promptOptions(config),
			});
			runtime.registeredNativeWebSearchTools.add(WEB_SEARCH_TOOL_NAME);
		}
		if ((!config.voiceFeaturesOnly && config.tools.imageGeneration) || config.tools.imageGenerationOnly) {
			registerImageGenerationTool(pi, { customRustBinariesDir: config.tools.customRustBinariesDir, allowConfiguredProvider, allowCodexProviderFallback, ...renderOptions(config), ...promptOptions(config) });
		}
	};
	if (!runtime.state.config.voiceFeaturesOnly) registerCore(runtime.state.config);
	ensureOptionalTools();
	return {
		ensureOptionalTools,
		applyConfig(config) {
			if (!config.voiceFeaturesOnly) registerCore(config);
			ensureOptionalTools(config);
			runtime.sessions.setBaseEnv(runtime.bundledPathToolsEnv(config));
		},
	};
}
