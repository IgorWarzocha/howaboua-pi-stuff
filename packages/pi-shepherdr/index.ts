import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentFleet } from "./src/fleet.js";
import { registerMasterMode } from "./src/master-mode.js";
import { registerAgentEventRenderer } from "./src/messages.js";
import { registerHerdrAgentsTool } from "./src/tool.js";

export default function shepherdrExtension(pi: ExtensionAPI): void {
	const fleet = new AgentFleet(pi);

	registerAgentEventRenderer(pi);
	registerHerdrAgentsTool(pi, fleet);
	registerMasterMode(pi, fleet);
}
