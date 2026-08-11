import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMasterMode } from "./src/master-mode.js";
import { registerAgentEventRenderer } from "./src/messages.js";
import { AgentMonitor } from "./src/monitor.js";
import { registerHerdrAgentsTool } from "./src/tool.js";

export default function herdrAgentsExtension(pi: ExtensionAPI): void {
	let monitor: AgentMonitor | undefined;
	const getMonitor = () => (monitor ??= new AgentMonitor(pi));

	registerAgentEventRenderer(pi);
	registerHerdrAgentsTool(pi, getMonitor);
	registerMasterMode(pi, getMonitor);
}
