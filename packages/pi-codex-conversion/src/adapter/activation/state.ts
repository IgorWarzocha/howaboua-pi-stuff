import type { PromptSkill } from "../../prompt/build-system-prompt.ts";
import type { SystemMessage } from "@earendil-works/pi-ai";
import type { CodexConversionConfig } from "./config.ts";
import type { ResponsesInputItem } from "../compaction/serializer.ts";
import type { CodexTurnState } from "../../providers/openai-codex/turn-state.ts";
import type { ExecutionMode } from "./execution-mode.ts";
import type { CodexDeveloperMessageBridge } from "../developer-messages.ts";
import type { CodexUsageStatus } from "../../codex-usage/payload.ts";

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
	/** Native checkpoint named by Pi's effective context, including restored branches. */
	replayCompaction?: { sessionId: string; entryId: string } | undefined;
	usageStatus?: CodexUsageStatus | undefined;
	config: CodexConversionConfig;
	executionMode: ExecutionMode;
	notebookStatusMessageId?: string | undefined;
	codexTurnState: CodexTurnState;
	developerMessages: CodexDeveloperMessageBridge;
	pendingPiCompactionNativeWindow?: PendingPiCompactionNativeWindow | undefined;
}
