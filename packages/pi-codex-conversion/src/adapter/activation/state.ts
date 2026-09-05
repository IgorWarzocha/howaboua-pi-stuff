import type { PromptSkill } from "../../prompt/build-system-prompt.ts";
import type { CodexConversionConfig } from "./config.ts";
import type { ResponsesInputItem } from "../compaction/serializer.ts";
import type { CodexTurnState } from "../../providers/openai-codex/turn-state.ts";
import type { ExecutionMode } from "./execution-mode.ts";
import type { CodexDeveloperMessageBridge } from "../developer-messages.ts";
import type { CodexContextWindowManager } from "../../context-management/window-manager.ts";
import type { CodexContextTreeCoordinator } from "../../context-management/tree-coordinator.ts";

export interface PendingPiCompactionNativeWindow {
	window: ResponsesInputItem[];
	provider: string;
	api: string;
	baseUrl: string;
	sessionId: string;
	sourceCompactionEntryId?: string | undefined;
}

export interface AdapterState {
	enabled: boolean;
	availableToolNames?: string[] | undefined;
	cwd: string;
	adapterOwnedToolNames?: string[] | undefined;
	codeModeExtensionToolNames?: string[] | undefined;
	previousToolNames?: string[] | undefined;
	promptSkills: PromptSkill[];
	activeProviderSystemPrompt?: string | undefined;
	pendingActiveProviderPromptCapture?: boolean | undefined;
	voiceSystemPromptOverride?: string | undefined;
	weeklyUsageLeft?: number | undefined;
	config: CodexConversionConfig;
	executionMode: ExecutionMode;
	codexTurnState: CodexTurnState;
	developerMessages: CodexDeveloperMessageBridge;
	contextWindows: CodexContextWindowManager;
	contextTree: CodexContextTreeCoordinator;
	pendingPiCompactionNativeWindow?: PendingPiCompactionNativeWindow | undefined;
}
