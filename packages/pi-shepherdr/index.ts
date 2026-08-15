import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentFleet } from "./src/fleet.js";
import { registerMasterMode } from "./src/master-mode.js";
import { registerAgentEventRenderer } from "./src/messages.js";
import { registerHerdrAgentsTool } from "./src/tool.js";

export default function shepherdrExtension(pi: ExtensionAPI): void {
	let fleet: AgentFleet | undefined;
	const getFleet = () => (fleet ??= new AgentFleet(pi));

	registerAgentEventRenderer(pi);
	registerHerdrAgentsTool(pi, getFleet);
	registerMasterMode(pi, getFleet);
}
