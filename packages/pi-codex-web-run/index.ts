import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { webRunCodeModeResult } from "./src/code-mode.js";
import { resolveHostedCodexToolProvider } from "./src/codex-runtime/policy.js";
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
		resolveProvider: (ctx) => resolveHostedCodexToolProvider(pi, ctx),
		promptSnippet: false,
	});
	pi.registerTool(tool);
	let gpt = false;
	let registration: Awaited<ReturnType<typeof registerWebRunInCodeMode>>;
	const ordinary = {
		description: tool.description,
		guidelines: tool.promptGuidelines,
	};
	try {
		const { registerGptPromptMode } = await import(
			"@howaboua/pi-codex-conversion/prompt-mode"
		);
		registerGptPromptMode(pi, (active) => {
			if (gpt !== active) {
				gpt = active;
				tool.description = active
					? "Web search/navigation"
					: ordinary.description;
				if (active)
					tool.promptGuidelines = [
						"web_run: calls=returned turn refs; final citations=Markdown result URLs; never refs/cite…",
					];
				else if (ordinary.guidelines)
					tool.promptGuidelines = ordinary.guidelines;
				else delete tool.promptGuidelines;
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
	registration = await registerWebRunInCodeMode(pi, tool, () => gpt);
	pi.on("session_shutdown", () => registration?.unregister());
}

async function registerWebRunInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createWebSearchTool>,
	gpt: () => boolean,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import(CODE_MODE_MODULE);
		return registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				usage: gpt()
					? 'await tools.web__run({search_query?:[{q:string,recency?:number,domains?:string[]}],image_query?:[{q:string}],open?:[{ref_id:string,lineno?:number}],click?:[{ref_id:string,id:number}],find?:[{ref_id:string,pattern:string}],response_length?:"short"|"medium"|"long"}) // calls=returned ref_ids; final citations=Markdown result URLs; never refs/cite markers'
					: 'await tools.web__run({search_query?:[{q:string,recency?:number,domains?:string[]}],image_query?:[{q:string}],open?:[{ref_id:string,lineno?:number}],click?:[{ref_id:string,id:number}],find?:[{ref_id:string,pattern:string}],response_length?:"short"|"medium"|"long"}) // calls use returned ref_ids; final answers use Markdown result URLs, never refs/cite markers',
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
