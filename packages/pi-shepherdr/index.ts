import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { isBlockingAgentsCall } from "./src/agents-contract.js";
import { acceptFocus, registerFocusArrivals } from "./src/agents-focus.js";
import { createAgentsTool } from "./src/agents-tool.js";
import { AgentBoard } from "./src/board/host.js";
import { registerAgentController } from "./src/controller.js";
import { registerDeveloperDelivery } from "./src/delivery.js";
import { AgentFleet } from "./src/fleet.js";
import { registerAgentEventRenderer } from "./src/messages.js";
import { createPeerCommands } from "./src/peer-commands.js";
import { registerPeerInbox } from "./src/peer-inbox.js";
import { installAgentProfiles } from "./src/profiles.js";
import { registerSharedAgentContext } from "./src/shared-context.js";
import { registerVoiceFocusReceiver } from "./src/voice-handoff.js";

const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = `${CODE_MODE_PACKAGE}/code-mode`;

export default async function shepherdrExtension(
	pi: ExtensionAPI,
): Promise<void> {
	registerPackageChangelog(pi);

	await installAgentProfiles();
	await registerDeveloperDelivery(pi);
	const peerCommands = createPeerCommands(pi);
	const fleet = new AgentFleet(pi);
	registerFocusArrivals(pi);
	registerVoiceFocusReceiver(pi, (ctx, pane, request) =>
		acceptFocus(pi, ctx, fleet, pane, request),
	);
	const board = AgentBoard.create(pi, fleet);
	registerPeerInbox(pi, peerCommands, fleet, (ctx) => board.promptCatchup(ctx));
	const sharedContext = await registerSharedAgentContext(pi, fleet, board);
	const tool = createAgentsTool(fleet, sharedContext, board, pi, peerCommands);

	registerAgentEventRenderer(pi);
	pi.registerTool(tool);
	await registerAgentsInCodeMode(pi, tool);
	registerAgentController(pi, fleet, peerCommands);
}

async function registerAgentsInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createAgentsTool>,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				prepareInput: (input) => (input === undefined ? {} : input),
				blocking: isBlockingAgentsCall,
				usage: "await tools.agents() // Persistent agents; first call alone",
			}),
		]);
		pi.on("session_shutdown", () => {
			registration.unregister();
		});
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
