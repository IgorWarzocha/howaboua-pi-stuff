import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BoardNestedParameters } from "../contract.js";
import { initializeDelivery, isMissingOptionalModule } from "../delivery.js";
import { createBoardTool } from "../tool.js";
import type { BoardRuntime } from "./coordinator.js";

export async function activateBoard(pi: ExtensionAPI, runtime: BoardRuntime) {
	await initializeDelivery();
	const tool = createBoardTool(runtime);
	pi.registerTool(tool);
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(
			pi,
			() => [
				adaptToolForCodeMode(
					{ ...tool, parameters: BoardNestedParameters },
					{
						prepareInput: (input) =>
							input === undefined || input === null ? {} : input,
						discovery: "help",
					},
				),
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
