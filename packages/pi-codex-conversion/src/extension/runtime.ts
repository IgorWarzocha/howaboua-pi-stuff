import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model, TranscriptContext } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { dirname } from "node:path";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { readCodexCacheEnvironment } from "../adapter/activation/cache-environment.ts";
import { getCodexConversionConfigPath, readEffectiveCodexConversionConfig } from "../adapter/activation/config-store.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { isProviderContextExcludedMessage } from "../adapter/prompt/context-filter.ts";
import { createCodexTurnState } from "../providers/openai-codex/turn-state.ts";
import type { CodexPrewarmUsage, CodexUsageRecorder, OpenAICodexStreamOptions, ResponsesBody, CodexDiagnosticsSink } from "../providers/openai-codex/types.ts";
import { createExecCommandTracker } from "../tools/exec/command-state.ts";
import { createExecSessionManager } from "../tools/exec/session-manager.ts";
import { getBundledToolBinaryPath } from "../tools/native/binary.ts";
import type { BackgroundBashWidgetState } from "../ui/background-bash-widget.ts";
import { CodexVoiceController } from "../voice/controller.ts";
import { CodexLanVoiceServerController } from "../voice/lan/controller.ts";
import { hasRealtimeWebSearch } from "../voice/realtime-web-search.ts";
import { createLazyCodexDiagnostics } from "../diagnostics/lazy.ts";
import { CodexDeveloperMessageBridge } from "../adapter/developer-messages.ts";
import { projectCodexDeveloperHistory } from "../adapter/developer-history.ts";
import { createAutoReasoning } from "../adapter/auto-reasoning.ts";
import { createCodexExtensionTransport } from "./transport/runtime.ts";

export type CodexContext = ExtensionContext;

export type CodexPrewarmResult =
	| { status: "ready"; usage?: CodexPrewarmUsage | undefined; socketReused?: boolean | undefined }
	| { status: "skipped" }
	| { status: "aborted" }
	| { status: "failed"; error: Error };

export interface CodexExtensionRuntime {
	autoReasoning: ReturnType<typeof createAutoReasoning>;
	state: AdapterState;
	tracker: ReturnType<typeof createExecCommandTracker>;
	sessions: ReturnType<typeof createExecSessionManager>;
	backgroundWidget: BackgroundBashWidgetState;
	voice: CodexVoiceController;
	lanVoice: CodexLanVoiceServerController;
	projectContextMessages(ctx: CodexContext, messages?: readonly AgentMessage[]): AgentMessage[];
	execEnv(config?: CodexConversionConfig): NodeJS.ProcessEnv;
	prepareTurn(ctx: CodexContext): void;
	suspendOrdinaryPrewarm(): void;
	finishTurn(): void;
	beforeRequestSend(model: Model<Api>, context: TranscriptContext, body: ResponsesBody, options: OpenAICodexStreamOptions | undefined, responsesLite: boolean): Promise<void>;
	startKeepalivePrewarm(ctx: CodexContext): Promise<CodexPrewarmResult> | undefined;
	armCacheKeepalive(ctx: CodexContext): void;
	cancelCacheKeepalive(): void;
	resetTransport(sessionId?: string): void;
	resetTransportForContextWindow(sessionId: string): void;
	shutdownTransport(sessionId: string): void;
	configureDiagnostics(ctx: CodexContext, announceLog?: boolean): Promise<void>;
	diagnosticsSink(sessionId: string | undefined): CodexDiagnosticsSink | undefined;
	shutdownDiagnostics(): Promise<void>;
}

export function createCodexExtensionRuntime(pi: ExtensionAPI, recordUsage?: CodexUsageRecorder): CodexExtensionRuntime {
	const cacheEnvironment = readCodexCacheEnvironment();
	for (const warning of cacheEnvironment.warnings) {
		console.warn(`[pi-codex-conversion] ${warning}`);
	}
	const initialConfig = readEffectiveCodexConversionConfig({ cwd: process.cwd(), projectTrusted: false });
	const voice = new CodexVoiceController(pi);
	const state: AdapterState = {
		enabled: false,
		cwd: process.cwd(),
		promptSkills: [],
		config: initialConfig,
		executionMode: initialConfig.executionMode,
		codexTurnState: createCodexTurnState(),
		developerMessages: new CodexDeveloperMessageBridge(),
	};
	const tracker = createExecCommandTracker();
	const sessions = createExecSessionManager({
		env: { ...process.env },
		bridgeBinaryPath: () => getBundledToolBinaryPath("exec_bridge", {}, state.config.tools.customRustBinariesDir),
	});
	const diagnostics = createLazyCodexDiagnostics();
	let cacheEnvironmentWarningsReported = false;

	const projectContextMessages = (ctx: CodexContext, messages?: readonly AgentMessage[]) =>
		projectCodexDeveloperHistory(ctx.sessionManager.getBranch(), messages)
			.filter(message => !isProviderContextExcludedMessage(message));

	const transport = createCodexExtensionTransport(pi, state, diagnostics, projectContextMessages, recordUsage);

	const runtime: CodexExtensionRuntime = {
		autoReasoning: createAutoReasoning(pi, state),
		state,
		tracker,
		sessions,
		backgroundWidget: { folded: true },
		voice,
		lanVoice: new CodexLanVoiceServerController(
			voice,
			() => state.config,
			(text, ctx) => {
				if (ctx.isIdle()) pi.sendUserMessage(text);
				else pi.sendUserMessage(text, { deliverAs: "steer" });
			},
			dirname(getCodexConversionConfigPath()),
			() => hasRealtimeWebSearch(pi),
		),
		execEnv(_config = state.config) {
			return { ...process.env };
		},
		projectContextMessages,
		...transport,
		configureDiagnostics(ctx, announceLog = false) {
			if (!cacheEnvironmentWarningsReported && cacheEnvironment.warnings.length > 0) {
				cacheEnvironmentWarningsReported = true;
				ctx.ui.notify(`Codex cache diagnostics: ${cacheEnvironment.warnings.join("; ")}`, "warning");
			}
			return diagnostics.configure({
				mode: state.config.openai.cacheDiagnostics,
				active: ctx.model?.api === "openai-codex-responses",
				ctx,
				agentDir: dirname(getCodexConversionConfigPath()),
				logName: cacheEnvironment.logName,
				announceLog: announceLog || cacheEnvironment.logName !== undefined,
			});
		},
		diagnosticsSink(sessionId) {
			return diagnostics.sink({ sessionId });
		},
		shutdownDiagnostics() {
			return diagnostics.shutdown();
		},
	};
	return runtime;
}
