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
	registration = await registerImagegenInCodeMode(pi, tool);
	pi.on("session_shutdown", () => registration?.unregister());
}

async function registerImagegenInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createImageGenerationTool>,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		return registerCodeModeExtensionTools(pi, () => {
			const adapted = adaptToolForCodeMode(tool, {
				discovery: "help",
				usage:
					"tools.image_gen__imagegen(args) // string→text(result); image→generatedImage(result); MUST NOT print/serialize base64",
				promptMetadata: false,
				deferLoading: true,
				toolName: { namespace: "image_gen", name: "imagegen" },
				resultValue: imagegenCodeModeResult,
			});
			return [
				{
					...adapted,
					async invoke(...args: Parameters<typeof adapted.invoke>) {
						const [input] = args;
						if (
							input == null ||
							(typeof input === "object" &&
								!Array.isArray(input) &&
								Object.keys(input).length === 0)
						)
							return [
								"Usage: " + adapted.usage,
								"Schema: " + JSON.stringify(adapted.inputSchema),
							].join("\n");
						return adapted.invoke(...args);
					},
				},
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
