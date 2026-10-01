import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readEffectiveCodexConversionConfig } from "../adapter/activation/config-store.ts";
import { syncAdapter } from "../adapter/activation/activation.ts";
import { resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import { supportsCodexDeveloperMessages } from "../adapter/provider-request.ts";
import { onCodeModeExtensionToolsRefresh } from "../code-mode-extension-tools.ts";
import { extractPiPromptSkills } from "../prompt/build-system-prompt.ts";
import type { CodeModeProxyProviderRegistration } from "../providers/code-mode-proxy-provider.ts";
import { maybeWarnLocalCheckoutVersion } from "../adapter/local-version-warning.ts";
import { clearApplyPatchRenderState } from "../tools/apply-patch/tool.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import { initializeBashParser } from "../shell/bash.ts";
import { appendNotebookTreeEpoch } from "../tools/notebook-mode/session-identity.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import type { CodexToolRegistration } from "./tools.ts";
import type { CodexUiController } from "./ui.ts";
import { registerCodexDeveloperMessageBroker, updateCodexPreparedIdleKickoff } from "../developer-messages.ts";
import type { ExtensionHandler, SessionStartEvent, ModelSelectEvent, SessionBeforeSwitchEvent, SessionBeforeForkEvent, SessionBeforeTreeEvent, SessionTreeEvent, SessionShutdownEvent, SessionBeforeSwitchResult, SessionBeforeForkResult, SessionBeforeTreeResult } from "@earendil-works/pi-coding-agent";

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
	const unregisterDeveloperMessageBroker = registerCodexDeveloperMessageBroker(
		pi,
		() => Boolean(
			activeContext &&
			supportsCodexDeveloperMessages(activeContext, state),
		),
		() => activeContext?.isIdle() ?? false,
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
			updateCodexPreparedIdleKickoff(pi, "session_reset");
			activate(ctx);
			state.notebookStatusMessageId = undefined;
			ui.invalidateUsageStatus();
			await runtime.lanVoice.stop(ctx);
			runtime.voice.resetContextAnnouncements();
			runtime.voice.resetSessionContext();
			initializeBashParser();
			runtime.resetTransport();
			state.developerMessages.clear();
			state.contextWindows.reset();
			state.contextKickoff.reset();
			state.contextTree.beginSession(pi);
			runtime.backgroundWidget.ctx = ctx;
			state.cwd = ctx.cwd;
			state.config = readEffectiveCodexConversionConfig({
				cwd: ctx.cwd,
				projectTrusted: ctx.isProjectTrusted(),
			});
			state.executionMode = state.config.executionMode;
			proxyProvider.applyConfig(state.config, ctx.modelRegistry);
			state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
			if (state.config.voiceFeaturesOnly) {
				clearApplyPatchRenderState();
				ui.clearBackgroundWidget();
				syncAdapter(pi, ctx, state);
				await runtime.configureDiagnostics(ctx);
				return;
			}
			sessions.setBaseEnv(runtime.execEnv());
			tracker.clear();
			clearApplyPatchRenderState();
			ui.renderBackgroundWidget();
			syncAdapter(pi, ctx, state);
			// A fresh worker may adopt its family before its first prepared turn.
			state.contextWindows.restore(ctx.sessionManager.getBranch());
			await runtime.configureDiagnostics(ctx);
			void ui.refreshUsageStatus(ctx);
			prepareCodeModeHost(codeMode, ctx);
			if (event.reason === "startup") await maybeWarnLocalCheckoutVersion(ctx);
		},
		modelSelected: async (_event, ctx) => {
			state.contextTree.handoff.reset();
			modelSelected(ctx);
			activate(ctx);
			ui.invalidateUsageStatus();
			runtime.resetTransport(ctx.sessionManager.getSessionId());
			state.cwd = ctx.cwd;
			state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
			proxyProvider.applyConfig(state.config, ctx.modelRegistry);
			if (state.config.voiceFeaturesOnly) {
				ui.clearBackgroundWidget();
				syncAdapter(pi, ctx, state);
				await runtime.configureDiagnostics(ctx);
				return;
			}
			const plan = syncAdapter(pi, ctx, state);
			state.contextWindows.ensureInitialized(
				pi,
				ctx,
				plan.contextManagement,
			);
			await runtime.configureDiagnostics(ctx);
			void ui.refreshUsageStatus(ctx);
			prepareCodeModeHost(codeMode, ctx);
		},
		beforeSwitch: () => state.contextTree.handoff.active ? { cancel: true } : undefined,
		beforeFork: () => state.contextTree.handoff.active ? { cancel: true } : undefined,
		beforeTree: (event, ctx) => {
			if (state.contextTree.handoff.active) return { cancel: true };
			if (state.contextTree.archiving) return;
			const plan = resolveCodexRuntimePlanForState(ctx, state);
			if (!plan.contextManagement || !event.preparation.userWantsSummary) return;
			return state.contextTree.handoff.prepare(pi, event, ctx, plan.contextManagementMode);
		},
		tree: async (event, ctx) => {
			updateCodexPreparedIdleKickoff(pi, "session_reset");
			activate(ctx);
			const previousMode = state.executionMode;
			runtime.resetTransport(ctx.sessionManager.getSessionId());
			if (state.contextTree.handleSessionTree(event)) return;
			state.notebookStatusMessageId = undefined;
			if (previousMode === "notebook" || state.executionMode === "notebook") appendNotebookTreeEpoch(pi);
			await codeMode.shutdownHost();
			proxyProvider.applyConfig(state.config, ctx.modelRegistry);
			const plan = syncAdapter(pi, ctx, state);
			state.contextWindows.ensureInitialized(
				pi,
				ctx,
				plan.contextManagement,
			);
			prepareCodeModeHost(codeMode, ctx);
			if (previousMode === "notebook" || state.executionMode === "notebook") {
				ctx.ui.notify("Notebook state reset after conversation-tree navigation", "info");
			}
		},
		shutdown: async (_event, ctx) => {
			updateCodexPreparedIdleKickoff(pi, "session_reset");
			const failures: unknown[] = [];
			pendingExtensionToolRefresh = false;
			await runShutdownStep(failures, unregisterExtensionToolRefresh);
			await runShutdownStep(failures, () => ui.invalidateBackgroundWidget());
			await runShutdownStep(failures, () => runtime.lanVoice.stop(ctx));
			await runShutdownStep(failures, () => runtime.voice.stop({ announce: true }));
			// Voice's persisted end policy still needs the active developer broker.
			activeContext = undefined;
			await runShutdownStep(failures, unregisterDeveloperMessageBroker);
			await runShutdownStep(failures, () => runtime.shutdownTransport(ctx.sessionManager.getSessionId()));
			await runShutdownStep(failures, () => runtime.shutdownDiagnostics());
			await runShutdownStep(failures, () => sessions.shutdown());
			await runShutdownStep(failures, () => tools.shutdown());
			await runShutdownStep(failures, () => proxyProvider.shutdown());
			await runShutdownStep(failures, () => codeMode.shutdown());
			state.developerMessages.clear();
			state.contextWindows.reset();
			state.contextKickoff.reset();
			state.contextTree.reset();
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1) throw new AggregateError(failures, "Codex extension shutdown failed");
		},
		activate,
		flushToolRefresh,
	} satisfies {
		activate: (ctx: ExtensionContext) => void;
		flushToolRefresh: (ctx: ExtensionContext) => void;
		start: ExtensionHandler<SessionStartEvent>;
		modelSelected: ExtensionHandler<ModelSelectEvent>;
		beforeSwitch: ExtensionHandler<SessionBeforeSwitchEvent, SessionBeforeSwitchResult>;
		beforeFork: ExtensionHandler<SessionBeforeForkEvent, SessionBeforeForkResult>;
		beforeTree: ExtensionHandler<SessionBeforeTreeEvent, SessionBeforeTreeResult>;
		tree: ExtensionHandler<SessionTreeEvent>;
		shutdown: ExtensionHandler<SessionShutdownEvent>;
	};
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && (
		error.name === "AbortError"
		|| error.name === "ABORT_ERR"
		|| (error as Error & { code?: unknown }).code === "ABORT_ERR"
	);
}

export function prepareCodeModeHost(codeMode: CodeModeRegistration, ctx: ExtensionContext): void {
	void codeMode.prepare(ctx)?.catch((error: unknown) => {
		if (isAbortError(error)) return;
		ctx.ui.notify(`Code Mode host setup failed: ${error instanceof Error ? error.message : String(error)}`, "error");
	});
}

async function runShutdownStep(failures: unknown[], action: () => unknown): Promise<void> {
	try {
		await action();
	} catch (error) {
		failures.push(error);
	}
}
