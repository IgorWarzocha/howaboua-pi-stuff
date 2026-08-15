import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import howabouaPiAsk from "@howaboua/pi-ask";
import howabouaPiAutoReasoningTool from "@howaboua/pi-auto-reasoning-tool";
import howabouaPiAutoTrees from "@howaboua/pi-auto-trees";
import howabouaPiCacheHitPredictor from "@howaboua/pi-cache-hit-predictor";
import howabouaPiDynamicTools from "@howaboua/pi-dynamic-tools";
import howabouaPiExploreSubagents from "@howaboua/pi-explore-subagents";
import howabouaPiGippityControl from "@howaboua/pi-gippity-control";
import howabouaPiGptSwitcher from "@howaboua/pi-gpt-switcher";
import howabouaPiMarkdownWorkflows from "@howaboua/pi-markdown-workflows";
import howabouaPiMemories from "@howaboua/pi-memories";
import howabouaPiSemanticGrep from "@howaboua/pi-semantic-grep";
import howabouaPiShepherdr from "@howaboua/pi-shepherdr";
import howabouaPiSmartBtw from "@howaboua/pi-smart-btw";
import howabouaPiSubagentReview from "@howaboua/pi-subagent-review";
import howabouaPiUnicodeCharts from "@howaboua/pi-unicode-charts";
import howabouaPiVent from "@howaboua/pi-vent";

export default async function (pi: ExtensionAPI) {
	await howabouaPiAsk(pi);
	await howabouaPiAutoReasoningTool(pi);
	await howabouaPiAutoTrees(pi);
	await howabouaPiCacheHitPredictor(pi);
	await howabouaPiDynamicTools(pi);
	await howabouaPiExploreSubagents(pi);
	await howabouaPiGippityControl(pi);
	await howabouaPiGptSwitcher(pi);
	await howabouaPiMarkdownWorkflows(pi);
	await howabouaPiMemories(pi);
	await howabouaPiSemanticGrep(pi);
	await howabouaPiShepherdr(pi);
	await howabouaPiSmartBtw(pi);
	await howabouaPiSubagentReview(pi);
	await howabouaPiUnicodeCharts(pi);
	await howabouaPiVent(pi);
}
