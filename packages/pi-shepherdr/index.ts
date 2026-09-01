import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { registerAgentController } from "./src/controller.js";
import { AgentFleet } from "./src/fleet.js";
import { registerAgentEventRenderer } from "./src/messages.js";
import { registerHerdrAgentsTool } from "./src/tool.js";

export default function shepherdrExtension(pi: ExtensionAPI): void {
	registerPackageChangelog(pi);
	const fleet = new AgentFleet(pi);

	registerAgentEventRenderer(pi);
	registerHerdrAgentsTool(pi, fleet);
	registerAgentController(pi, fleet);
}
