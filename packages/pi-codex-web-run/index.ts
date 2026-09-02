import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { webRunCodeModeResult } from "./src/code-mode.js";
import { isConfiguredCodexToolProvider } from "./src/codex-runtime/index.js";
import { createWebSearchTool } from "./src/tool.js";

const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = CODE_MODE_PACKAGE + "/code-mode";

export { webRunCodeModeResult } from "./src/code-mode.js";
export { executeCodexWebSearch } from "./src/execute.js";
export { createWebSearchTool } from "./src/tool.js";

export default async function webRunExtension(pi: ExtensionAPI): Promise<void> {
	registerPackageChangelog(pi);
	const tool = createWebSearchTool("web_run", {
		allowCodexProviderFallback: true,
		allowConfiguredProvider: (model) =>
			isConfiguredCodexToolProvider(pi, model),
		promptSnippet: false,
	});
	pi.registerTool(tool);
	const registration = await registerWebRunInCodeMode(pi, tool);
	pi.on("session_shutdown", () => registration?.unregister());
}

async function registerWebRunInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createWebSearchTool>,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		return registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				usage:
					'await tools.web__run({search_query?:[{q:string,recency?:number,domains?:string[]}],image_query?:[{q:string}],open?:[{ref_id:string,lineno?:number}],click?:[{ref_id:string,id:number}],find?:[{ref_id:string,pattern:string}],response_length?:"short"|"medium"|"long"}) // calls use returned ref_ids; final answers use Markdown result URLs, never refs/cite markers',
				promptMetadata: false,
				toolName: { namespace: "web", name: "run" },
				resultValue: webRunCodeModeResult,
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
