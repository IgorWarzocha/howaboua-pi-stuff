import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { isBlockingAgentsCall } from "./src/agents-contract.js";
import { acceptFocus, registerFocusArrivals } from "./src/agents-focus.js";
import { createAgentsTool } from "./src/agents-tool.js";
import { AgentBoard } from "./src/board/host.js";
import { registerAgentController } from "./src/controller.js";
import { registerCoreStatus } from "./src/core/status.js";
import { registerDeveloperDelivery } from "./src/delivery.js";
import { AgentFleet } from "./src/fleet/index.js";
import { registerAgentEventRenderer } from "./src/messages/render.js";
import { createPeerCommands } from "./src/peer-commands.js";
import { registerPeerInbox } from "./src/peer-inbox.js";
import { registerProfilePrompt } from "./src/profile-prompt.js";
import { installAgentProfiles } from "./src/profiles.js";
import { registerSharedAgentContext } from "./src/shared-context-host.js";
import { registerVoiceFocusReceiver } from "./src/voice-handoff.js";
import { registerWorkerRole } from "./src/worker-role.js";
import { registerWorkerService } from "./src/worker-service.js";

const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = `${CODE_MODE_PACKAGE}/code-mode`;

export default async function shepherdrExtension(
	pi: ExtensionAPI,
): Promise<void> {
	registerCoreStatus(pi);
	const workerRole = registerWorkerRole(pi);
	registerPackageChangelog(pi);

	await installAgentProfiles();
	registerProfilePrompt(pi);
	registerDeveloperDelivery(pi);
	const peerCommands = createPeerCommands(pi);
	const fleet = new AgentFleet(pi);
	registerFocusArrivals(pi);
	registerVoiceFocusReceiver(pi, (ctx, pane, request) =>
		acceptFocus(pi, ctx, fleet, pane, request),
	);
	const board = AgentBoard.create(pi, fleet);
	registerPeerInbox(pi, peerCommands, fleet, (ctx) => board.promptCatchup(ctx));
	const sharedContext = await registerSharedAgentContext(pi, fleet, board);
	registerWorkerService(pi, fleet, sharedContext, board, workerRole);
	let promptMode: { readonly active: boolean } | undefined;
	const tool = createAgentsTool(
		fleet,
		sharedContext,
		board,
		pi,
		peerCommands,
		() => promptMode?.active ?? false,
	);

	registerAgentEventRenderer(pi);
	pi.registerTool(tool);
	try {
		const { registerGptPromptMode } = await import(
			"@howaboua/pi-codex-conversion/prompt-mode"
		);
		promptMode = registerGptPromptMode(pi, () => [tool]);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			![
				"ERR_MODULE_NOT_FOUND",
				"MODULE_NOT_FOUND",
				"ERR_PACKAGE_PATH_NOT_EXPORTED",
			].includes(String(error.code)) ||
			!error.message.includes(CODE_MODE_PACKAGE)
		)
			throw error;
	}
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
				discovery: "help",
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
