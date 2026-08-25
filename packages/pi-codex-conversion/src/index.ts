import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mergeAdapterTools, restoreTools, stripAdapterTools } from "./adapter/activation/activation.ts";
import { getCodexSkillPaths } from "./adapter/prompt/skills.ts";
import { registerCodexConversion } from "./extension/register.ts";

export default async function codexConversion(pi: ExtensionAPI): Promise<void> {
	const changelogUrl = import.meta.url.endsWith(".ts")
		? new URL("../changelog.ts", import.meta.url)
		: new URL("../changelog.js", import.meta.url);
	const { default: registerPackageChangelog } = (await import(
		changelogUrl.href
	)) as { default: (pi: ExtensionAPI) => void };
	registerPackageChangelog(pi);
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
