import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mergeAdapterTools, restoreTools, stripAdapterTools } from "./adapter/activation/activation.ts";
import { getCodexSkillPaths } from "./adapter/prompt/skills.ts";
import { registerCodexConversion } from "./extension/register.ts";

export default async function codexConversion(pi: ExtensionAPI): Promise<void> {
	await registerCodexConversion(pi);
}

export type {
	ApplyPatchPartialFailureDetails,
	ApplyPatchRenderCall,
	ApplyPatchRenderResult,
	ApplyPatchSuccessDetails,
	ApplyPatchToolDetails,
	ApplyPatchToolOptions,
	ExecutePatchResult,
} from "./tools/apply-patch/tool.ts";
export {
	createApplyPatchTool,
	isApplyPatchToolDetails,
	registerApplyPatchResultEvent,
} from "./tools/apply-patch/tool.ts";
export { getCodexSkillPaths, mergeAdapterTools, restoreTools, stripAdapterTools };
