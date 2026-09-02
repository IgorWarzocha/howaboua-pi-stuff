import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BrowserRoutes, loadBrowserRoutes } from "./src/browser/routes.js";
import { BrowserRuntime } from "./src/browser/runtime.js";
import { registerBrowserCommand } from "./src/browser/settings.js";
import {
	createBrowserTool,
	prepareBrowserCodeModeInput,
} from "./src/browser-tool.js";

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
	const tool = createBrowserTool(runtime);
	registerBrowserCommand(pi);
	pi.registerTool(tool);
	const registration = await registerBrowserInCodeMode(
		pi,
		tool,
		runtime.hosts.length > 0,
	);
	pi.on("session_shutdown", () => {
		registration?.unregister();
		runtime.close();
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
	routed: boolean,
) {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		return registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				kind: "freeform",
				prepareInput: prepareBrowserCodeModeInput,
				usage: `await tools.browser("help"); await tools.browser(JSON.stringify({ action: "tabs" })) // Logged-in ${
					routed ? "routed " : "local "
				}browser with web__run refs; ask before consequential external actions`,
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
	) {
		return false;
	}
	if (error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
		return (
			error.message.includes("Package subpath './code-mode'") &&
			error.message.includes(CODE_MODE_PACKAGE)
		);
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
