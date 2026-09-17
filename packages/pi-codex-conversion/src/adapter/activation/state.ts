import type { PromptSkill } from "../../prompt/build-system-prompt.ts";
import type { SystemMessage } from "@earendil-works/pi-ai";
import type { CodexConversionConfig } from "./config.ts";
import type { ResponsesInputItem } from "../compaction/serializer.ts";
import type { CodexTurnState } from "../../providers/openai-codex/turn-state.ts";
import type { ExecutionMode } from "./execution-mode.ts";
import type { CodexDeveloperMessageBridge } from "../developer-messages.ts";
import type { CodexContextWindowManager } from "../../context-management/window-manager.ts";
import type { CodexContextWindowKickoff } from "../../context-management/window-kickoff.ts";
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
	/** Managed names whose provider gates passed at the last projection refresh. */
	activeCodeModeExtensionToolNames?: string[] | undefined;
	/** Last adapter policy and output, used to distinguish external loadout edits. */
	appliedRuntimeKind?: "inactive" | "extras" | "normal" | "code" | "notebook" | undefined;
	appliedRuntimeToolNames?: string[] | undefined;
	appliedActiveToolNames?: string[] | undefined;
	previousToolNames?: string[] | undefined;
	promptSkills: PromptSkill[];
	preparedPrompt?: {
		sessionId: string;
		provider: string;
		api: string;
		model: string;
		baseUrl: string;
		executionMode: ExecutionMode;
		transport: "responses" | "responses-lite";
		systemMessage: SystemMessage;
	} | undefined;
	weeklyUsageLeft?: number | undefined;
	config: CodexConversionConfig;
	executionMode: ExecutionMode;
	codexTurnState: CodexTurnState;
	developerMessages: CodexDeveloperMessageBridge;
	contextWindows: CodexContextWindowManager;
	contextKickoff: CodexContextWindowKickoff;
	contextTree: CodexContextTreeCoordinator;
	pendingPiCompactionNativeWindow?: PendingPiCompactionNativeWindow | undefined;
}
