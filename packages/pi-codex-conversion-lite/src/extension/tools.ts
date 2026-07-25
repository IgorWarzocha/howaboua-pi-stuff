import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { usesCodexProviderFallback } from "../adapter/activation/runtime-plan.ts";
import { WEB_SEARCH_TOOL_NAME } from "../adapter/activation/tool-set.ts";
import { isResponsesModel } from "../adapter/prompt/codex-model.ts";
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

export function isExplicitlyConfiguredToolProvider(model: Model<Api> | undefined, config: CodexConversionConfig): boolean {
	const provider = model?.provider?.trim().toLowerCase();
	return Boolean(isResponsesModel(model) && provider && config.scope.additionalProviders.some((entry) => entry.trim().toLowerCase() === provider));
}

export function registerCodexTools(pi: ExtensionAPI, runtime: CodexExtensionRuntime): CodexToolRegistration {
	const renderOptions = (config: CodexConversionConfig) => ({ customRendering: config.ui.toolRenaming });
	const registerCore = (config: CodexConversionConfig) => {
		registerApplyPatchTool(pi, { showDiffWhenCollapsed: !config.ui.compactTools });
		registerExecCommandTool(pi, runtime.tracker, runtime.sessions, {
			...renderOptions(config),
			showOutputWhenCollapsed: true,
		});
		registerWriteStdinTool(pi, runtime.sessions);
		registerViewImageTool(pi, { describeForTextModels: config.tools.viewImageFallback, ...renderOptions(config) });
	};
	const ensureOptionalTools = (config = runtime.state.config) => {
		if (config.voiceFeaturesOnly) return;
		const allowConfiguredProvider = (model: Model<Api> | undefined): boolean =>
			isExplicitlyConfiguredToolProvider(model, config);
		const allowCodexProviderFallback = usesCodexProviderFallback(config);
		if (config.tools.webRun || config.tools.webRunOnly) {
			registerWebSearchTool(pi, WEB_SEARCH_TOOL_NAME, {
				getRecentInput: () => runtime.latestRecentWebSearchInput,
				model: () => runtime.state.config.openai.webSearchModel,
				allowConfiguredProvider,
				allowCodexProviderFallback,
				...renderOptions(config),
			});
		}
		if (config.tools.imageGeneration || config.tools.imageGenerationOnly) {
			registerImageGenerationTool(pi, { allowConfiguredProvider, allowCodexProviderFallback, ...renderOptions(config) });
		}
	};
	if (!runtime.state.config.voiceFeaturesOnly) registerCore(runtime.state.config);
	ensureOptionalTools();
	return {
		ensureOptionalTools,
		applyConfig(config) {
			if (!config.voiceFeaturesOnly) registerCore(config);
			ensureOptionalTools(config);
			runtime.sessions.setBaseEnv(runtime.execEnv(config));
		},
	};
}
