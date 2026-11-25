import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodeModeProxyProvider } from "../providers/code-mode-proxy-provider.ts";
import { registerOpenAICodexCustomProvider } from "../providers/openai-codex-custom-provider.ts";
import { registerApplyPatchDisplayBroker } from "../tools/apply-patch/display-broker.ts";
import { registerCodexCommand } from "../ui/settings/command.ts";
import { registerCodexCodeMode } from "../adapter/code-mode.ts";
import { registerCodexEvents } from "./events.ts";
import { prepareExecutionHost } from "./session-lifecycle.ts";
import { createCodexExtensionRuntime } from "./runtime.ts";
import { registerCodexTools } from "./tools.ts";
import { registerCodexUi } from "./ui.ts";
import { registerCodexVoiceRenderer } from "../voice/ui.ts";
import { registerVoiceHandoff } from "../voice/handoff.ts";
import {
	hasCodexTransportConfigChanged,
	isAdapterRuntime,
	resolveAdapterRuntimePlanForState,
} from "../adapter/activation/runtime-plan.ts";
import { hasCodexCacheKeepalivePlanChanged } from "../adapter/activation/cache-keepalive.ts";
import { recordCodexSpend } from "../codex-usage/ledger-store.ts";
import { registerCodexAgentRelationships } from "../agent-relationship.ts";
import { registerProtectedOutputHost } from "../tools/code-mode/protected-output.ts";
import { registerNotesMigrationGuard } from "./notes-migration.ts";

export async function registerCodexConversion(pi: ExtensionAPI): Promise<void> {
	registerNotesMigrationGuard(pi);
	registerCodexVoiceRenderer(pi);
	registerApplyPatchDisplayBroker(pi);
	registerCodexAgentRelationships(pi);
	const runtime = createCodexExtensionRuntime(pi, recordCodexSpend);
	const codeMode = await registerCodexCodeMode(pi, runtime);
	let cleanupProxyProvider:
		| ReturnType<typeof registerCodeModeProxyProvider>
		| undefined;
	try {
		registerOpenAICodexCustomProvider(pi, {
			getConfig: () => ({
				executionMode: runtime.state.executionMode,
				openai: runtime.state.config.openai,
				compaction: runtime.state.config.compaction,
			}),
			useResponsesLite: (model) =>
				resolveAdapterRuntimePlanForState({ model }, runtime.state)
					.responsesFormat === "responses-lite",
			turnState: runtime.state.codexTurnState,
			getDiagnostics: (sessionId) => runtime.diagnosticsSink(sessionId),
			beforeRequestSend: runtime.beforeRequestSend,
			recordUsage: recordCodexSpend,
		});
		const proxyProvider = registerCodeModeProxyProvider(
			pi,
			() => runtime.state.config,
			() => runtime.state.executionMode,
			() => runtime.state.availableToolNames,
			runtime.beforeRequestSend,
		);
		cleanupProxyProvider = proxyProvider;
		const tools = registerCodexTools(pi, runtime);
		const ui = registerCodexUi(pi, runtime);
		registerCodexCommand(
			pi,
			runtime.state,
			runtime.voice,
			runtime.lanVoice,
			(config, ctx, previousConfig) => {
				const executionModeChanged =
					config.executionMode !== previousConfig.executionMode;
				if (
					executionModeChanged ||
					config.notebook.maxHeapMiB !== previousConfig.notebook.maxHeapMiB ||
					(runtime.state.bindingStatus?.kind === "ts" &&
						config.notebook.profile !== previousConfig.notebook.profile)
				)
					runtime.state.bindingStatus = undefined;
				tools.applyConfig(config);
				runtime.state.availableToolNames = pi
					.getAllTools()
					.map((tool) => tool.name);
				proxyProvider.applyConfig(config, ctx.modelRegistry);
				ui.applyConfig(config, ctx, previousConfig);
				if (
					config.openai.cacheDiagnostics !==
					previousConfig.openai.cacheDiagnostics
				) {
					void runtime.configureDiagnostics(
						ctx,
						previousConfig.openai.cacheDiagnostics !== "status-and-log" &&
							config.openai.cacheDiagnostics === "status-and-log",
					);
				}
				if (
					hasCodexCacheKeepalivePlanChanged(
						ctx.model?.id,
						previousConfig.openai,
						config.openai,
					)
				) {
					runtime.cancelCacheKeepalive();
				}
				if (hasCodexTransportConfigChanged(previousConfig, config)) {
					runtime.resetTransport(ctx.sessionManager.getSessionId());
				}
				if (executionModeChanged) {
					void codeMode
						.shutdownHost()
						.then(() => prepareExecutionHost(codeMode, ctx))
						.catch((error: unknown) => {
							ctx.ui.notify(
								`Could not switch execution mode: ${error instanceof Error ? error.message : String(error)}`,
								"warning",
							);
						});
				}
			},
		);
		registerCodexEvents(pi, runtime, tools, ui, codeMode, proxyProvider);
		registerVoiceHandoff({
			pi,
			voice: runtime.voice,
			lanVoice: runtime.lanVoice,
			getConfig: () => runtime.state.config,
			priority: () => (runtime.state.enabled ? 20 : 5),
		});
		const stopProtectedOutput = registerProtectedOutputHost(pi, (ctx) => {
			const plan = resolveAdapterRuntimePlanForState(ctx, runtime.state);
			return plan.codexTransport && isAdapterRuntime(plan);
		});
		pi.on("session_shutdown", stopProtectedOutput);
	} catch (registrationError) {
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
