import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import howabouaPiAsk from "@howaboua/pi-ask";
import howabouaPiAutoTrees from "@howaboua/pi-auto-trees";
import howabouaPiBetterSkillsTool from "@howaboua/pi-better-skills-tool";
import howabouaPiCacheHitPredictor from "@howaboua/pi-cache-hit-predictor";
import howabouaPiGippityControl from "@howaboua/pi-gippity-control";
import howabouaPiGptSwitcher from "@howaboua/pi-gpt-switcher";
import howabouaPiGrokRealtime from "@howaboua/pi-grok-realtime";
import howabouaPiPet from "@howaboua/pi-pet";
import howabouaPiShepherdr from "@howaboua/pi-shepherdr";
import howabouaPiSmartBtw from "@howaboua/pi-smart-btw";
import howabouaPiSubagentReview from "@howaboua/pi-subagent-review";
import howabouaPiUnicodeCharts from "@howaboua/pi-unicode-charts";

export default async function (pi: ExtensionAPI) {
	registerPackageChangelog(pi);
	await howabouaPiAsk(pi);
	await howabouaPiAutoTrees(pi);
	await howabouaPiBetterSkillsTool(pi);
	await howabouaPiCacheHitPredictor(pi);
	await howabouaPiGippityControl(pi);
	await howabouaPiGptSwitcher(pi);
	await howabouaPiGrokRealtime(pi);
	await howabouaPiPet(pi);
	await howabouaPiShepherdr(pi);
	await howabouaPiSmartBtw(pi);
	await howabouaPiSubagentReview(pi);
	await howabouaPiUnicodeCharts(pi);
}
