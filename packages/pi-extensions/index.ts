import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import howabouaPiAutoReasoningTool from "@howaboua/pi-auto-reasoning-tool";
import howabouaPiAutoTrees from "@howaboua/pi-auto-trees";
import howabouaPiExploreSubagents from "@howaboua/pi-explore-subagents";
import howabouaPiMarkdownWorkflows from "@howaboua/pi-markdown-workflows";
import howabouaPiMemories from "@howaboua/pi-memories";
import howabouaPiSemanticGrep from "@howaboua/pi-semantic-grep";
import howabouaPiSmartBtw from "@howaboua/pi-smart-btw";
import howabouaPiSubagentReview from "@howaboua/pi-subagent-review";
import howabouaPiVent from "@howaboua/pi-vent";

export default async function (pi: ExtensionAPI) {
	await howabouaPiAutoReasoningTool(pi);
	await howabouaPiAutoTrees(pi);
	await howabouaPiExploreSubagents(pi);
	await howabouaPiMarkdownWorkflows(pi);
	await howabouaPiMemories(pi);
	await howabouaPiSemanticGrep(pi);
	await howabouaPiSmartBtw(pi);
	await howabouaPiSubagentReview(pi);
	await howabouaPiVent(pi);
}
