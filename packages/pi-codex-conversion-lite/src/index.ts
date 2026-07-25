import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mergeAdapterTools, restoreTools, stripAdapterTools } from "./adapter/activation/activation.ts";
import { getCodexSkillPaths } from "./adapter/prompt/skills.ts";
import { registerCodexConversion } from "./extension/register.ts";

export default async function codexConversion(pi: ExtensionAPI): Promise<void> {
	await registerCodexConversion(pi);
}

export { getCodexSkillPaths, mergeAdapterTools, restoreTools, stripAdapterTools };
