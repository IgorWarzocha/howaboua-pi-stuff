import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isConfiguredCodexToolProvider } from "@howaboua/pi-codex-tool-runtime";
import registerPackageChangelog from "./changelog.js";
import { imagegenCodeModeResult } from "./src/code-mode.js";
import { createImageGenerationTool } from "./src/tool.js";

const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = CODE_MODE_PACKAGE + "/code-mode";

export { imagegenCodeModeResult } from "./src/code-mode.js";
export { executeCodexImageGeneration } from "./src/execute.js";
export type { ImagegenOutput } from "./src/output.js";
export { createImageGenerationTool } from "./src/tool.js";

export default async function imagegenExtension(
	pi: ExtensionAPI,
): Promise<void> {
	registerPackageChangelog(pi);
	const tool = createImageGenerationTool({
		allowCodexProviderFallback: true,
		allowConfiguredProvider: (model) =>
			isConfiguredCodexToolProvider(pi, model),
		promptSnippet: false,
	});
	pi.registerTool(tool);
	const registration = await registerImagegenInCodeMode(pi, tool);
	pi.on("session_shutdown", () => registration?.unregister());
}

async function registerImagegenInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createImageGenerationTool>,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		return registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				usage:
					"generatedImage(await tools.image_gen__imagegen({prompt:string,referenced_image_paths?:string[],num_last_images_to_include?:number})) // no selectors=generate; paths/recent count=edit; never text/serialize base64 result",
				promptMetadata: false,
				toolName: { namespace: "image_gen", name: "imagegen" },
				resultValue: imagegenCodeModeResult,
			}),
		]);
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
	)
		return false;
	if (error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
		return (
			error.message.includes("Package subpath './code-mode'") &&
			error.message.includes(CODE_MODE_PACKAGE)
		);
	}
	if (
		error.code !== "ERR_MODULE_NOT_FOUND" &&
		error.code !== "MODULE_NOT_FOUND"
	)
		return false;
	const missing = error.message.match(
		/Cannot find (?:package|module) ['"]([^'"]+)['"]/,
	)?.[1];
	return missing === CODE_MODE_PACKAGE || missing === CODE_MODE_MODULE;
}
