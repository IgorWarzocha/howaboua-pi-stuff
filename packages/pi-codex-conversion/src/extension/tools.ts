import type { Api, Model } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ToolLoadout,
	ToolLoadoutChanges,
} from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { hiddenPiReplacementToolNames } from "../adapter/activation/tool-set.ts";
import {
	registerCodexToolProviderPolicy,
	registerCodexToolProviderResolver,
	resolveCodexToolProvider,
} from "../adapter/codex-tool-provider.ts";
import { isResponsesModel } from "../adapter/prompt/model-support.ts";
import {
	registerApplyPatchResultEvent,
	createApplyPatchTool,
} from "../tools/apply-patch/tool.ts";
import { createExecCommandTool } from "../tools/exec/command-tool.ts";
import { createWriteStdinTool } from "../tools/exec/write-stdin-tool.ts";
import { createViewImageTool } from "../tools/view-image/tool.ts";
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
	const prepareLoadout = (
		loadout: ToolLoadout,
	): ToolLoadoutChanges | undefined => {
		if (runtime.state.appliedRuntimeKind !== "normal") return undefined;
		return {
			hiddenDeclarations: hiddenPiReplacementToolNames(
				"normal",
				loadout.declared.map(({ name }) => name),
			),
		};
	};
	// Declaration hiding preserves Pi admission but does not block execution.
	pi.on("tool_call", (event) => {
		if (
			hiddenPiReplacementToolNames(
				runtime.state.appliedRuntimeKind,
				pi.getActiveTools(),
			).includes(event.toolName)
		)
			return {
				block: true,
				reason: "Use the active Codex tools instead.",
			};
		return undefined;
	});
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
		pi.registerTool({
			...createApplyPatchTool({
				customRustBinariesDir: config.tools.customRustBinariesDir,
				showDiffWhenCollapsed: config.ui.toolDetails === "preview",
			}),
			prepareLoadout,
		});
		pi.registerTool({
			...createExecCommandTool(runtime.tracker, runtime.sessions, {
				...renderOptions(config),
				showOutputWhenCollapsed: true,
			}),
			prepareLoadout,
		});
		pi.registerTool({
			...createWriteStdinTool(runtime.sessions, {
				showOutputWhenCollapsed: true,
			}),
			prepareLoadout,
		});
		pi.registerTool({
			...createViewImageTool({
				customRustBinariesDir: config.tools.customRustBinariesDir,
				describeForTextModels: config.tools.viewImageFallback,
				...renderOptions(config),
			}),
			prepareLoadout,
		});
	};
	registerCore(runtime.state.config);
	return {
		applyConfig(config) {
			registerCore(config);
			runtime.sessions.setBaseEnv(runtime.execEnv(config));
		},
		shutdown() {
			unregisterProviderResolver();
			unregisterProviderPolicy();
		},
	};
}
