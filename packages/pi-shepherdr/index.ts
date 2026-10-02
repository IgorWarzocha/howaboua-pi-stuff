import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { isBlockingAgentsCall } from "./src/agents-contract.js";
import { createAgentsTool } from "./src/agents-tool.js";
import { ensureBoardConfig } from "./src/board/config.js";
import { AgentBoard } from "./src/board/host.js";
import { createBoardTool } from "./src/board/tool.js";
import { registerAgentController } from "./src/controller.js";
import { registerDeveloperDelivery } from "./src/delivery.js";
import { AgentFleet } from "./src/fleet.js";
import { registerAgentEventRenderer } from "./src/messages.js";
import { registerPeerInbox } from "./src/peer-inbox.js";
import { installAgentProfiles } from "./src/profiles.js";
import { registerSharedAgentContext } from "./src/shared-context.js";

const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = `${CODE_MODE_PACKAGE}/code-mode`;

export default async function shepherdrExtension(
	pi: ExtensionAPI,
): Promise<void> {
	registerPackageChangelog(pi);
	ensureBoardConfig();
	await installAgentProfiles();
	await registerDeveloperDelivery(pi);
	registerPeerInbox(pi);
	const fleet = new AgentFleet(pi);
	const board = new AgentBoard(pi, fleet);
	const sharedContext = await registerSharedAgentContext(pi, fleet, board);
	const tool = createAgentsTool(fleet, sharedContext, board);
	const boardTool = createBoardTool(board);

	registerAgentEventRenderer(pi);
	pi.registerTool(tool);
	pi.registerTool(boardTool);
	await registerAgentsInCodeMode(pi, tool, boardTool, board);
	registerAgentController(pi, fleet, board);
}

async function registerAgentsInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createAgentsTool>,
	boardTool: ReturnType<typeof createBoardTool>,
	board: AgentBoard,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				blocking: isBlockingAgentsCall,
				usage:
					'await tools.agents({ action: "help" }) // Persistent agents; first call alone',
			}),
		]);
		const boardRegistration = registerCodeModeExtensionTools(
			pi,
			() => [
				adaptToolForCodeMode(boardTool, {
					usage:
						'await tools.board({ action: "help" }) // Shared discussion archive',
				}),
			],
			{ isActive: (ctx) => board.enabled(ctx) },
		);
		board.setToolRefresh(() => boardRegistration.refresh());
		pi.on("session_shutdown", () => {
			registration.unregister();
			boardRegistration.unregister();
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
