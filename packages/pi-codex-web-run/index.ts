import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { webRunCodeModeResult } from "./src/code-mode.js";
import { resolveHostedCodexToolProvider } from "./src/codex-runtime/policy.js";
import type { WebSearchToolOptions } from "./src/contract.js";
import { registerCodexWebRunService } from "./src/service.js";
import { createWebSearchTool } from "./src/tool.js";

const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = CODE_MODE_PACKAGE + "/code-mode";

export { webRunCodeModeResult } from "./src/code-mode.js";
export type { WebRunExecutionResult } from "./src/execute.js";
export { executeCodexWebSearch } from "./src/execute.js";
export {
	CODEX_WEB_RUN_SERVICE,
	type CodexWebRunService,
	type CodexWebRunServiceRequest,
} from "./src/service.js";
export { createWebSearchTool } from "./src/tool.js";

export default async function webRunExtension(pi: ExtensionAPI): Promise<void> {
	const options: WebSearchToolOptions = {
		allowCodexProviderFallback: true,
		resolveProvider: (ctx) => resolveHostedCodexToolProvider(pi, ctx),
		promptSnippet: false,
	};
	const tool = createWebSearchTool("web_run", options);
	pi.registerTool(tool);
	const registration = await registerWebRunInCodeMode(pi, tool);
	registerCodexWebRunService(pi, options);
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
					'tools.web__run({search_query?:[{q:string,recency?:number,domains?:string[]}],image_query?:[{q:string}],open?:[{ref_id:string,lineno?:number}],click?:[{ref_id:string,id:number}],find?:[{ref_id:string,pattern:string}],response_length?:"short"|"medium"|"long",settings?:{search_context_size?:"low"|"medium"|"high"}}) // navigation→returned ref_ids (open: URLs too); cite only Markdown result links',
				promptMetadata: false,
				toolName: { namespace: "web", name: "run" },
				resultValue: webRunCodeModeResult,
			}),
		]);
	} catch (error) {
		if (isMissingCodeModeExtension(error)) return undefined;
		if (isOutdatedCodeModeExtension(error)) {
			throw new Error(
				"Update " +
					CODE_MODE_PACKAGE +
					" to 3.0.24 or newer to use Codex Web Run with it",
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
