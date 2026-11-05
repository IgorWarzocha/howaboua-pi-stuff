import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { imagegenCodeModeResult } from "./src/code-mode.js";
import { resolveHostedCodexToolProvider } from "./src/codex-runtime/policy.js";
import { imageGenerationParameters } from "./src/contract.js";
import { readImagegenSettings } from "./src/settings.js";
import { registerImagegenSettings } from "./src/settings-ui.js";
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
	const tool = createImageGenerationTool({
		allowCodexProviderFallback: true,
		resolveProvider: (ctx) => resolveHostedCodexToolProvider(pi, ctx),
		promptSnippet: false,
	});
	pi.registerTool(tool);
	let gpt = false;
	let registration: Awaited<ReturnType<typeof registerImagegenInCodeMode>>;
	const refresh = () => {
		const parameters = imageGenerationParameters(readImagegenSettings().access);
		if (tool.parameters === parameters) return;
		tool.parameters = parameters;
		pi.registerTool(tool);
		registration?.refresh();
	};
	registerImagegenSettings(pi, refresh);
	pi.on("session_start", refresh);
	pi.on("before_agent_start", refresh);
	const ordinary = {
		description: tool.description,
	};
	try {
		const { registerGptPromptMode } = await import(
			"@howaboua/pi-codex-conversion/prompt-mode"
		);
		registerGptPromptMode(pi, (active) => {
			if (gpt !== active) {
				gpt = active;
				tool.description = active
					? "Generate/edit images; no selectors=generate"
					: ordinary.description;
				pi.registerTool(tool);
				registration?.refresh();
			}
			return [tool];
		});
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
	registration = await registerImagegenInCodeMode(pi, tool, () => gpt);
	pi.on("session_shutdown", () => registration?.unregister());
}

async function registerImagegenInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createImageGenerationTool>,
	gpt: () => boolean,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import(CODE_MODE_MODULE);
		return registerCodeModeExtensionTools(pi, () => {
			const api = "size" in tool.parameters.properties;
			return [
				adaptToolForCodeMode(tool, {
					usage:
						"await tools.image_gen__imagegen({prompt:string,transparent_background?:boolean,referenced_image_paths?:string[],num_last_images_to_include?:number" +
						(api
							? ',output_format?:"png"|"jpeg"|"webp"|"gif"|"svg",size?:string,gif?:{frame_count?:number,frame_duration_ms?:number}'
							: "") +
						'}).then(r=>typeof r==="string"?text(r):generatedImage(r)) // ' +
						(gpt()
							? "prompt: aspect ratio+quality; cutouts=transparent; edits retain transparency; no selectors=generate; paths/recent count=edit; " +
								(api ? "GIF/SVG=generate; " : "") +
								"NEVER text/serialize base64"
							: "prompt: include target aspect ratio and quality; transparency for cutouts, preserve existing transparency in edits; no selectors=generate; paths/recent count=edit; " +
								(api ? "GIF/SVG generation only; " : "") +
								"never text/serialize base64 result"),
					promptMetadata: false,
					deferLoading: true,
					toolName: { namespace: "image_gen", name: "imagegen" },
					resultValue: imagegenCodeModeResult,
				}),
			];
		});
	} catch (error) {
		if (isMissingCodeModeExtension(error)) return undefined;
		if (isOutdatedCodeModeExtension(error)) {
			throw new Error(
				"Update " +
					CODE_MODE_PACKAGE +
					" to 3.0.24 or newer to use Codex Imagegen with it",
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
	)
		return false;
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
