import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isBlockingAgentsCall } from "./agents-contract.js";
import { createAgentsTool } from "./agents-tool.js";
import { AgentFleet } from "./fleet.js";
import { registerMasterMode } from "./master-mode.js";
import { registerAgentEventRenderer } from "./messages.js";

const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = `${CODE_MODE_PACKAGE}/code-mode`;

export default async function shepherdr2Extension(
	pi: ExtensionAPI,
): Promise<void> {
	const fleet = new AgentFleet(pi, { agentToolName: "agents" });
	const tool = createAgentsTool(fleet);

	registerAgentEventRenderer(pi);
	pi.registerTool(tool);
	const registration = await registerAgentsInCodeMode(pi, tool, fleet);
	registerMasterMode(pi, fleet, {
		toolName: tool.name,
		onActiveChange: () => registration?.refresh(),
	});
}

async function registerAgentsInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createAgentsTool>,
	fleet: AgentFleet,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(
			pi,
			() => [
				adaptToolForCodeMode(tool, {
					blocking: isBlockingAgentsCall,
					usage: "await tools.agents({ action, ...args })",
				}),
			],
			{ isActive: () => fleet.isActive() },
		);
		pi.on("session_shutdown", () => registration.unregister());
		return registration;
	} catch (error) {
		if (isMissingCodeModeExtension(error)) return undefined;
		throw error;
	}
}

function isMissingCodeModeExtension(error: unknown): boolean {
	if (
		!error ||
		typeof error !== "object" ||
		!("code" in error) ||
		!("message" in error) ||
		typeof error.message !== "string"
	) {
		return false;
	}
	if (error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
		return (
			error.message.includes("Package subpath './code-mode'") &&
			error.message.includes(CODE_MODE_PACKAGE)
		);
	}
	if (
		error.code !== "ERR_MODULE_NOT_FOUND" &&
		error.code !== "MODULE_NOT_FOUND"
	) {
		return false;
	}
	const missing = error.message.match(
		/Cannot find (?:package|module) ['"]([^'"]+)['"]/,
	)?.[1];
	return missing === CODE_MODE_PACKAGE || missing === CODE_MODE_MODULE;
}
