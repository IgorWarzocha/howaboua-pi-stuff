import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BrowserRoutes, loadBrowserRoutes } from "./src/browser/routes.js";
import { BrowserRuntime } from "./src/browser/runtime.js";
import { registerBrowserCommand } from "./src/browser/settings.js";
import { createBrowserTool, prepareBrowserInput } from "./src/browser-tool.js";

export { createBrowserTool } from "./src/browser-tool.js";

const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = `${CODE_MODE_PACKAGE}/code-mode`;

export default async function browserExtension(
	pi: ExtensionAPI,
): Promise<void> {
	let configError: string | undefined;
	let routes: BrowserRoutes;
	try {
		routes = loadBrowserRoutes();
	} catch (error) {
		routes = new BrowserRoutes();
		configError = error instanceof Error ? error.message : String(error);
	}
	const runtime = new BrowserRuntime(routes);
	let gpt = false;
	const tool = createBrowserTool(runtime, () => gpt);
	registerBrowserCommand(pi);
	pi.registerTool(tool);
	try {
		const { registerGptPromptMode } = await import(
			"@howaboua/pi-codex-conversion/prompt-mode"
		);
		registerGptPromptMode(pi, (active) => {
			gpt = active;
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

	const registration = await registerBrowserInCodeMode(pi, tool);
	pi.on("session_shutdown", async () => {
		registration?.unregister();
		await runtime.close();
	});
	if (configError) {
		pi.on("session_start", (_event, ctx) => {
			ctx.ui.notify(`${configError}. Run /browser to repair it.`, "warning");
		});
	}
}

async function registerBrowserInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createBrowserTool>,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		return registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				kind: "freeform",
				prepareInput: prepareBrowserInput,
				discovery: "help",
				resultValue: (result) => result.details,
			}),
		]);
	} catch (error) {
		if (isMissingCodeModeExtension(error)) return undefined;
		if (isOutdatedCodeModeExtension(error)) {
			throw new Error(
				"Update " +
					CODE_MODE_PACKAGE +
					" to 3.0.24 or newer to use Pi Browser with it",
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
