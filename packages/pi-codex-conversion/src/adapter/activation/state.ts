import type { PromptSkill } from "../../prompt/build-system-prompt.ts";
import type { CodexConversionConfig } from "./config.ts";
import type { ResponsesInputItem } from "../compaction/serializer.ts";

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
	cwd: string;
	adapterOwnedToolNames?: string[] | undefined;
	previousToolNames?: string[] | undefined;
	promptSkills: PromptSkill[];
	config: CodexConversionConfig;
	pendingPiCompactionNativeWindow?: PendingPiCompactionNativeWindow | undefined;
}
