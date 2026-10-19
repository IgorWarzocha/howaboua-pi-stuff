import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodeModeProxyProvider } from "../providers/code-mode-proxy-provider.ts";
import { registerOpenAICodexCustomProvider } from "../providers/openai-codex-custom-provider.ts";
import { registerApplyPatchDisplayBroker } from "../tools/apply-patch/display-broker.ts";
import { registerCodexCommand } from "../ui/settings/command.ts";
import { registerCodexCodeMode } from "../adapter/code-mode.ts";
import { registerCodexEvents } from "./events.ts";
import { prepareCodeModeHost } from "./session-lifecycle.ts";
import { createCodexExtensionRuntime } from "./runtime.ts";
import { registerCodexTools } from "./tools.ts";
import { registerCodexUi } from "./ui.ts";
import { registerCodexVoiceRenderer } from "../voice/ui.ts";
import { registerVoiceHandoff } from "../voice/handoff.ts";
import { hasCodexTransportConfigChanged, isAdapterRuntime, resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import { hasCodexCacheKeepalivePlanChanged } from "../adapter/activation/cache-keepalive.ts";
import { recordCodexSpend } from "../codex-usage/ledger-store.ts";
import { registerExternalNotesBridge } from "../context-management/external-notes-bridge.ts";
import { createExternalNotesRemoteService } from "../context-management/external-notes-remote.ts";
import { configureExternalNotesTools } from "../context-management/tools.ts";
import { registerGptPromptModeBroker } from "../prompt-mode.ts";

export async function registerCodexConversion(pi: ExtensionAPI): Promise<void> {
	registerCodexVoiceRenderer(pi);
	registerApplyPatchDisplayBroker(pi);
	const runtime = createCodexExtensionRuntime(pi, recordCodexSpend);
	const promptMode = registerGptPromptModeBroker(pi, ctx =>
		runtime.state.config.prompt.heavySystemPromptOverwrite === "gpt" &&
		isAdapterRuntime(resolveCodexRuntimePlanForState(ctx, runtime.state)));
	// Pi clones prompt options before hooks. Refresh owned metadata before Code
	// captures tools, and before the later conversion turn hook builds its prompt.
	pi.on("before_agent_start", (event, ctx) => promptMode.prepare(ctx, event.systemPromptOptions));
	pi.on("session_shutdown", () => promptMode.dispose());
	runtime.state.contextTree.register(pi);
	const codeMode = await registerCodexCodeMode(pi, runtime, ctx => promptMode.prepare(ctx))
		.catch(error => { promptMode.dispose(); throw error; });
	let cleanupProxyProvider: ReturnType<typeof registerCodeModeProxyProvider> | undefined;
	let cleanupNotesBridge: (() => void) | undefined;
	try {
		registerOpenAICodexCustomProvider(pi, {
			getConfig: () => ({ executionMode: runtime.state.executionMode, openai: runtime.state.config.openai, compaction: runtime.state.config.compaction }),
			useResponsesLite: (model) => resolveCodexRuntimePlanForState({ model }, runtime.state).transport === "responses-lite",
			turnState: runtime.state.codexTurnState,
			getDiagnostics: sessionId => runtime.diagnosticsSink(sessionId),
			beforeRequestSend: runtime.beforeRequestSend,
			recordUsage: recordCodexSpend,
		});
		const proxyProvider = registerCodeModeProxyProvider(pi, () => runtime.state.config, () => runtime.state.executionMode, () => runtime.state.availableToolNames, runtime.beforeRequestSend);
		cleanupProxyProvider = proxyProvider;
		const tools = registerCodexTools(pi, runtime);
		const unregisterNotesBridge = registerExternalNotesBridge(pi, runtime, codeMode, {
			...createExternalNotesRemoteService(tools.contextRouter),
			configureTools: (definitions, ctx, contracts) => configureExternalNotesTools(pi, runtime.state, definitions, ctx, contracts),
		});
		cleanupNotesBridge = unregisterNotesBridge;
		pi.on("session_shutdown", () => unregisterNotesBridge());
		const ui = registerCodexUi(pi, runtime);
		registerCodexCommand(pi, runtime.state, runtime.voice, runtime.lanVoice, (config, ctx, previousConfig) => {
			const executionModeChanged = config.executionMode !== previousConfig.executionMode;
			if (executionModeChanged || config.voiceFeaturesOnly !== previousConfig.voiceFeaturesOnly ||
				config.notebook.maxHeapMiB !== previousConfig.notebook.maxHeapMiB || config.notebook.profile !== previousConfig.notebook.profile)
				runtime.state.notebookStatusMessageId = undefined;
			tools.applyConfig(config);
			runtime.state.availableToolNames = pi.getAllTools().map((tool) => tool.name);
			promptMode.prepare(ctx);
			if (!runtime.state.externalNotes) runtime.state.contextWindows.ensureInitialized(
				pi,
				ctx,
				resolveCodexRuntimePlanForState(ctx, runtime.state).contextManagement,
			);
			proxyProvider.applyConfig(config, ctx.modelRegistry);
			ui.applyConfig(config, ctx, previousConfig);
			if (config.openai.cacheDiagnostics !== previousConfig.openai.cacheDiagnostics) {
				void runtime.configureDiagnostics(
					ctx,
					previousConfig.openai.cacheDiagnostics !== "status-and-log"
						&& config.openai.cacheDiagnostics === "status-and-log",
				);
			}
			if (hasCodexCacheKeepalivePlanChanged(ctx.model?.id, previousConfig.openai, config.openai)) {
				runtime.cancelCacheKeepalive();
			}
			if (hasCodexTransportConfigChanged(previousConfig, config)) {
				runtime.resetTransport(ctx.sessionManager.getSessionId());
			}
			if (config.voiceFeaturesOnly && !previousConfig.voiceFeaturesOnly) {
				void codeMode.shutdownHost().catch((error: unknown) => {
					ctx.ui.notify(`Could not stop Code Mode host: ${error instanceof Error ? error.message : String(error)}`, "warning");
				});
			} else if (executionModeChanged) {
				void codeMode.shutdownHost()
					.then(() => prepareCodeModeHost(codeMode, ctx))
					.catch((error: unknown) => {
						ctx.ui.notify(`Could not switch execution mode: ${error instanceof Error ? error.message : String(error)}`, "warning");
					});
			}
		});
		registerCodexEvents(pi, runtime, tools, ui, codeMode, proxyProvider);
		registerVoiceHandoff({
			pi, voice: runtime.voice, getConfig: () => runtime.state.config,
			priority: () => runtime.state.enabled || runtime.state.config.voiceFeaturesOnly ? 20 : 5,
		});
	} catch (registrationError) {
		promptMode.dispose();
		cleanupNotesBridge?.();
		try {
			try {
				cleanupProxyProvider?.shutdown();
			} finally {
				await codeMode.shutdown();
			}
		} catch (shutdownError) {
			throw new AggregateError(
				[registrationError, shutdownError],
				"Codex conversion registration and Code Mode cleanup failed",
			);
		}
		throw registrationError;
	}
}
