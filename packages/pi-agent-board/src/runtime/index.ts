import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBoardActivityRenderer } from "../activity.js";
import { initializeDelivery, isMissingOptionalModule } from "../delivery.js";
import { createBoardTool } from "../tool.js";
import { BoardRuntime } from "./coordinator.js";

export { BoardRuntime };

const CLAIM = "@howaboua/pi-agent-board.owner/v1";
const AVAILABLE = "@howaboua/pi-agent-board.available/v1";
interface OwnerClaim {
	runtime: Promise<BoardRuntime>;
}

/** Discover an explicitly loaded owner, including one loaded after this adapter. */
export function discoverBoard(
	pi: ExtensionAPI,
	attach: (runtime: BoardRuntime) => void,
) {
	let attached = false;
	const accept = (runtime: BoardRuntime) => {
		if (attached) return;
		attached = true;
		attach(runtime);
	};
	const request = () =>
		pi.events.emit(CLAIM, {
			accept: (claim: OwnerClaim) => {
				void claim.runtime.then(accept);
			},
		});
	const stop = pi.events.on(AVAILABLE, request);
	request();
	pi.on("session_shutdown", stop);
}

/** Only the standalone extension creates and registers the board engine. */
export async function acquireBoard(pi: ExtensionAPI): Promise<BoardRuntime> {
	let claim: OwnerClaim | undefined;
	pi.events.emit(CLAIM, {
		accept(value: OwnerClaim) {
			claim = value;
		},
	});
	if (!claim) {
		const created: OwnerClaim = {
			runtime: createRuntime(pi),
		};
		claim = created;
		const stop = pi.events.on(CLAIM, (value) => {
			if (
				value &&
				typeof value === "object" &&
				"accept" in value &&
				typeof value.accept === "function"
			)
				value.accept(created);
		});
		pi.on("session_shutdown", stop);
	}
	const runtime = await claim.runtime;
	pi.events.emit(AVAILABLE, undefined);
	return runtime;
}

async function createRuntime(pi: ExtensionAPI) {
	await initializeDelivery();
	const runtime = new BoardRuntime(pi);
	const tool = createBoardTool(runtime);
	pi.registerTool(tool);
	try {
		const { registerGptPromptMode, prepareGptPromptMode } = await import(
			"@howaboua/pi-codex-conversion/prompt-mode"
		);
		runtime.setPromptModePreparation((ctx) => prepareGptPromptMode(pi, ctx));
		registerGptPromptMode(pi, (active) => {
			runtime.gptPromptMode = active;
			return [tool];
		});
	} catch (error) {
		if (!isMissingOptionalModule(error, "prompt-mode")) throw error;
	}
	registerBoardActivityRenderer(pi);
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(
			pi,
			() => [
				adaptToolForCodeMode(tool, {
					prepareInput: (input) =>
						input === undefined || input === null ? {} : input,
					discovery: "help",
				}),
			],
			{ isActive: (ctx) => runtime.enabled(ctx) },
		);
		runtime.setToolRefresh(() => registration.refresh());
		pi.on("session_shutdown", () => registration.unregister());
	} catch (error) {
		if (!isMissingOptionalModule(error, "code-mode")) throw error;
		if (
			error instanceof Error &&
			"code" in error &&
			error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
		)
			throw new Error(
				"Update Codex Conversion to use its Code and Notebook board tools",
				{ cause: error },
			);
	}
	return runtime;
}
