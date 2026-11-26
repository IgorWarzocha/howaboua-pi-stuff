import {
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readEffectiveCodexConversionConfig } from "../adapter/activation/config-store.ts";
import { syncAdapter } from "../adapter/activation/activation.ts";
import {
	isAdapterRuntime,
	resolveAdapterRuntimePlanForState,
} from "../adapter/activation/runtime-plan.ts";
import { supportsCodexDeveloperMessages } from "../adapter/provider-request.ts";
import { onCodeModeExtensionToolsRefresh } from "../code-mode-extension-tools.ts";
import type { CodeModeProxyProviderRegistration } from "../providers/code-mode-proxy-provider.ts";
import { maybeWarnLocalCheckoutVersion } from "../adapter/local-version-warning.ts";
import { clearApplyPatchRenderState } from "../tools/apply-patch/tool.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import { initializeBashParser } from "../shell/bash.ts";
import { appendExecutionTreeEpoch } from "../tools/code-mode/session-identity.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import type { CodexToolRegistration } from "./tools.ts";
import type { CodexUiController } from "./ui.ts";
import { registerCodexDeveloperMessageBroker } from "../developer-messages.ts";
import { registerCodexContextBriefingHost } from "../context-briefings.ts";
import type {
	ExtensionHandler,
	SessionStartEvent,
	ModelSelectEvent,
	SessionTreeEvent,
	SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";

export function createCodexSessionLifecycle(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
	tools: CodexToolRegistration,
	ui: CodexUiController,
	codeMode: CodeModeRegistration,
	proxyProvider: CodeModeProxyProviderRegistration,
	modelSelected: (ctx: ExtensionContext) => void,
) {
	const { state, tracker, sessions } = runtime;
	let activeContext: ExtensionContext | undefined;
	let pendingExtensionToolRefresh = false;
	const unregisterContextBriefingHost = registerCodexContextBriefingHost(pi);
	const unregisterDeveloperMessageBroker = registerCodexDeveloperMessageBroker(
		pi,
		() =>
			Boolean(
				activeContext && supportsCodexDeveloperMessages(activeContext, state),
			),
	);
	const unregisterExtensionToolRefresh = onCodeModeExtensionToolsRefresh(
		pi,
		() => {
			if (!activeContext) return;
			if (!activeContext.isIdle()) {
				pendingExtensionToolRefresh = true;
				return;
			}
			pendingExtensionToolRefresh = false;
			syncAdapter(pi, activeContext, state);
		},
	);
	const activate = (ctx: ExtensionContext): void => {
		activeContext = ctx;
		pendingExtensionToolRefresh = false;
	};
	const flushToolRefresh = (ctx: ExtensionContext): void => {
		if (pendingExtensionToolRefresh) {
			pendingExtensionToolRefresh = false;
			syncAdapter(pi, ctx, state);
		}
	};

	return {
		start: async (event, ctx) => {
			activate(ctx);
			state.bindingStatus = undefined;
			ui.invalidateUsageStatus();
			await runtime.lanVoice.stop(ctx);
			runtime.voice.resetContextAnnouncements();
			runtime.voice.resetSessionContext();
			initializeBashParser();
			runtime.resetTransport();
			state.developerMessages.clear();
			runtime.backgroundWidget.ctx = ctx;
			state.cwd = ctx.cwd;
			state.config = readEffectiveCodexConversionConfig({
				cwd: ctx.cwd,
				projectTrusted: ctx.isProjectTrusted(),
				upgradeSettings: true,
			});
			state.executionMode = state.config.executionMode;
			proxyProvider.applyConfig(state.config, ctx.modelRegistry);
			sessions.setBaseEnv(runtime.execEnv());
			tracker.clear();
			clearApplyPatchRenderState();
			ui.renderBackgroundWidget();
			syncAdapter(pi, ctx, state);
			// A fresh worker may adopt its family before its first prepared turn.
			await runtime.configureDiagnostics(ctx);
			void ui.refreshUsageStatus(ctx);
			prepareExecutionHost(codeMode, ctx);
			if (event.reason === "startup") await maybeWarnLocalCheckoutVersion(ctx);
		},
		modelSelected: async (_event, ctx) => {
			modelSelected(ctx);
			activate(ctx);
			ui.invalidateUsageStatus();
			runtime.resetTransport(ctx.sessionManager.getSessionId());
			state.cwd = ctx.cwd;
			proxyProvider.applyConfig(state.config, ctx.modelRegistry);
			syncAdapter(pi, ctx, state);
			// Keep existing window state, but leave initial creation to the first prepared turn.
			await runtime.configureDiagnostics(ctx);
			void ui.refreshUsageStatus(ctx);
			prepareExecutionHost(codeMode, ctx);
		},
		tree: async (event, ctx) => {
			activate(ctx);
			if (event.oldLeafId !== event.newLeafId)
				runtime.voice.resetVoiceBranch(ctx);
			runtime.resetTransport(ctx.sessionManager.getSessionId());
			// Internal rollover preserves the admission that requested it.
			state.bindingStatus = undefined;
			const stateful =
				(state.executionMode === "ts" || state.executionMode === "vm") &&
				(state.enabled ||
					isAdapterRuntime(resolveAdapterRuntimePlanForState(ctx, state)));
			if (stateful) appendExecutionTreeEpoch(pi);
			await codeMode.shutdownHost();
			proxyProvider.applyConfig(state.config, ctx.modelRegistry);
			// Pi restored the branch's tool loadout, not its execution-mode setting.
			// Reapply the current mode while retaining non-adapter tool selections.
			delete state.appliedRuntimeKind;
			delete state.appliedRuntimeToolNames;
			delete state.suspendedNestedToolNames;
			syncAdapter(pi, ctx, state);
			prepareExecutionHost(codeMode, ctx);
			if (stateful) {
				ctx.ui.notify(
					`${state.executionMode === "vm" ? "VM Code bindings" : "TS Notebook state"} reset after conversation-tree navigation`,
					"info",
				);
			}
		},
		shutdown: async (_event, ctx) => {
			const failures: unknown[] = [];
			pendingExtensionToolRefresh = false;
			await runShutdownStep(failures, unregisterExtensionToolRefresh);
			await runShutdownStep(failures, () => ui.invalidateBackgroundWidget());
			await runShutdownStep(failures, () => runtime.lanVoice.stop(ctx));
			await runShutdownStep(failures, () =>
				runtime.voice.stop({ announce: true }),
			);
			// Voice's persisted end policy still needs the active developer broker.
			activeContext = undefined;
			await runShutdownStep(failures, unregisterDeveloperMessageBroker);
			await runShutdownStep(failures, unregisterContextBriefingHost);
			await runShutdownStep(failures, () =>
				runtime.shutdownTransport(ctx.sessionManager.getSessionId()),
			);
			await runShutdownStep(failures, () => runtime.shutdownDiagnostics());
			await runShutdownStep(failures, () => sessions.shutdown());
			await runShutdownStep(failures, () => tools.shutdown());
			await runShutdownStep(failures, () => proxyProvider.shutdown());
			await runShutdownStep(failures, () => codeMode.shutdown());
			state.developerMessages.clear();
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1)
				throw new AggregateError(failures, "Codex extension shutdown failed");
		},
		activate,
		flushToolRefresh,
	} satisfies {
		activate: (ctx: ExtensionContext) => void;
		flushToolRefresh: (ctx: ExtensionContext) => void;
		start: ExtensionHandler<SessionStartEvent>;
		modelSelected: ExtensionHandler<ModelSelectEvent>;
		tree: ExtensionHandler<SessionTreeEvent>;
		shutdown: ExtensionHandler<SessionShutdownEvent>;
	};
}

function isAbortError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "AbortError" ||
			error.name === "ABORT_ERR" ||
			(error as Error & { code?: unknown }).code === "ABORT_ERR")
	);
}

export function prepareExecutionHost(
	codeMode: CodeModeRegistration,
	ctx: ExtensionContext,
): void {
	void codeMode.prepare(ctx)?.catch((error: unknown) => {
		if (isAbortError(error)) return;
		ctx.ui.notify(
			`Execution host setup failed: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
	});
}

async function runShutdownStep(
	failures: unknown[],
	action: () => unknown,
): Promise<void> {
	try {
		await action();
	} catch (error) {
		failures.push(error);
	}
}
