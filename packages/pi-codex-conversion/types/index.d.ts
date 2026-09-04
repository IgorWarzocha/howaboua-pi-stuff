import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function codexConversion(pi: ExtensionAPI): Promise<void>;
export function getCodexSkillPaths(cwd: string, home?: string): string[];
export function mergeAdapterTools(
	activeTools: string[],
	adapterTools: string[],
	adapterOwnedTools?: string[],
): string[];
export function restoreTools(
	previousTools: string[],
	activeTools: string[],
	adapterOwnedTools?: string[],
): string[];
export function stripAdapterTools(
	toolNames: string[],
	adapterOwnedTools?: string[],
): string[];

export type {
	ApplyPatchPartialFailureDetails,
	ApplyPatchRenderCall,
	ApplyPatchRenderResult,
	ApplyPatchSuccessDetails,
	ApplyPatchToolDetails,
	ApplyPatchToolOptions,
	ExecutePatchResult,
} from "../dist/tools/apply-patch/tool.js";
export {
	createApplyPatchTool,
	isApplyPatchToolDetails,
	registerApplyPatchResultEvent,
} from "../dist/tools/apply-patch/tool.js";
export {
	sendCodexDeveloperMessage,
	trySendCodexDeveloperMessage,
	type CodexDeveloperMessageDelivery,
	type CodexDeveloperMessageOptions,
} from "../dist/developer-messages.js";
