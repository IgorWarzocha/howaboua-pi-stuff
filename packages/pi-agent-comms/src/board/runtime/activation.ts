import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initializeDelivery, isMissingOptionalModule } from "../delivery.js";
import { createBoardTool } from "../tool.js";
import type { BoardRuntime } from "./coordinator.js";

export async function activateBoard(pi: ExtensionAPI, runtime: BoardRuntime) {
	await initializeDelivery();
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
}
