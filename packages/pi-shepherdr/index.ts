import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { isBlockingAgentsCall } from "./src/agents-contract.js";
import { createAgentsTool } from "./src/agents-tool.js";
import { registerAgentController } from "./src/controller.js";
import { registerDeveloperDelivery } from "./src/delivery.js";
import { AgentFleet } from "./src/fleet.js";
import { registerAgentEventRenderer } from "./src/messages.js";
import { installAgentProfiles } from "./src/profiles.js";

const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = `${CODE_MODE_PACKAGE}/code-mode`;

export default async function shepherdrExtension(
	pi: ExtensionAPI,
): Promise<void> {
	registerPackageChangelog(pi);
	await installAgentProfiles();
	await registerDeveloperDelivery(pi);
	const fleet = new AgentFleet(pi);
	const tool = createAgentsTool(fleet);

	registerAgentEventRenderer(pi);
	pi.registerTool(tool);
	const registration = await registerAgentsInCodeMode(pi, tool, fleet);
	registerAgentController(pi, fleet, {
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
					usage: 'await tools.agents({ action: "help" }) // first call alone',
				}),
			],
			{ isActive: () => fleet.isActive() },
		);
		pi.on("session_shutdown", () => registration.unregister());
		return registration;
	} catch (error) {
		if (isMissingCodeModeExtension(error)) return undefined;
		if (isOutdatedCodeModeExtension(error)) {
			throw new Error(
				"Update " +
					CODE_MODE_PACKAGE +
					" to 3.0.24 or newer to use Shepherdr with it",
				{ cause: error },
			);
		}
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

function isOutdatedCodeModeExtension(error: unknown): boolean {
	if (
		!error ||
		typeof error !== "object" ||
		!("code" in error) ||
		!("message" in error) ||
		typeof error.message !== "string"
	)
		return false;
	return (
		(error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
			error.code === "ERR_UNSUPPORTED_DIR_IMPORT") &&
		(error.message.includes(CODE_MODE_MODULE) ||
			(error.message.includes("Package subpath './code-mode'") &&
				error.message.includes(CODE_MODE_PACKAGE)))
	);
}
