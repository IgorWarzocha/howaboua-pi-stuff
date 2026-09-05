import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import {
	registerCodexToolProviderPolicy,
	registerCodexToolProviderResolver,
	resolveCodexToolProvider,
} from "../adapter/codex-tool-provider.ts";
import { isResponsesModel } from "../adapter/prompt/codex-model.ts";
import {
	registerApplyPatchResultEvent,
	registerApplyPatchTool,
} from "../tools/apply-patch/tool.ts";
import { registerExecCommandTool } from "../tools/exec/command-tool.ts";
import { registerWriteStdinTool } from "../tools/exec/write-stdin-tool.ts";
import { registerViewImageTool } from "../tools/view-image/tool.ts";
import { registerContextManagementTools } from "../context-management/tools.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";

export interface CodexToolRegistration {
	applyConfig(config: CodexConversionConfig): void;
	shutdown(): void;
}

export function isExplicitlyConfiguredToolProvider(
	model: Model<Api> | undefined,
	config: CodexConversionConfig,
): boolean {
	const provider = model?.provider?.trim().toLowerCase();
	return Boolean(
		isResponsesModel(model) &&
			provider &&
			config.scope.additionalProviders.some(
				(entry) => entry.trim().toLowerCase() === provider,
			),
	);
}

export function registerCodexTools(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
): CodexToolRegistration {
	registerApplyPatchResultEvent(pi);
	pi.registerTool(runtime.autoReasoning.tool);
	registerContextManagementTools(pi, runtime.state);
	const allowsProvider = (model: Model<Api> | undefined) =>
		isExplicitlyConfiguredToolProvider(model, runtime.state.config);
	const unregisterProviderPolicy = registerCodexToolProviderPolicy(
		pi,
		(model) => allowsProvider(model as Model<Api> | undefined),
	);
	const unregisterProviderResolver = registerCodexToolProviderResolver(
		pi,
		(ctx) =>
			resolveCodexToolProvider(ctx, (model) =>
				allowsProvider(model as Model<Api> | undefined),
			),
	);
	const renderOptions = (config: CodexConversionConfig) => ({
		customRendering: config.ui.toolRenaming,
	});
	const registerCore = (config: CodexConversionConfig) => {
		registerApplyPatchTool(pi, {
			customRustBinariesDir: config.tools.customRustBinariesDir,
			showDiffWhenCollapsed: !config.ui.compactTools,
		});
		registerExecCommandTool(pi, runtime.tracker, runtime.sessions, {
			...renderOptions(config),
			showOutputWhenCollapsed: true,
		});
		registerWriteStdinTool(pi, runtime.sessions, {
			showOutputWhenCollapsed: true,
		});
		registerViewImageTool(pi, {
			customRustBinariesDir: config.tools.customRustBinariesDir,
			describeForTextModels: config.tools.viewImageFallback,
			...renderOptions(config),
		});
	};
	if (!runtime.state.config.voiceFeaturesOnly)
		registerCore(runtime.state.config);
	return {
		applyConfig(config) {
			if (!config.voiceFeaturesOnly) registerCore(config);
			runtime.sessions.setBaseEnv(runtime.execEnv(config));
		},
		shutdown() {
			unregisterProviderResolver();
			unregisterProviderPolicy();
		},
	};
}
