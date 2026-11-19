import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import howabouaPiAsk from "@howaboua/pi-ask";
import howabouaPiBetterSkillsTool from "@howaboua/pi-better-skills-tool";
import howabouaPiCacheHitPredictor from "@howaboua/pi-cache-hit-predictor";
import howabouaPiGippityControl from "@howaboua/pi-gippity-control";
import howabouaPiGithubWatch from "@howaboua/pi-github-watch";
import howabouaPiGptSwitcher from "@howaboua/pi-gpt-switcher";
import howabouaPiShepherdr from "@howaboua/pi-shepherdr";
import howabouaPiSuggestions from "@howaboua/pi-suggestions";
import howabouaPiUnicodeCharts from "@howaboua/pi-unicode-charts";

export default async function (pi: ExtensionAPI) {
	await howabouaPiAsk(pi);
	await howabouaPiBetterSkillsTool(pi);
	await howabouaPiCacheHitPredictor(pi);
	await howabouaPiGippityControl(pi);
	await howabouaPiGithubWatch(pi);
	await howabouaPiGptSwitcher(pi);
	await howabouaPiShepherdr(pi);
	await howabouaPiSuggestions(pi);
	await howabouaPiUnicodeCharts(pi);
}
