import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
	const tool = createBrowserTool();
	pi.registerTool(tool);
	await registerBrowserInCodeMode(pi, tool);
}

async function registerBrowserInCodeMode(
	pi: ExtensionAPI,
	tool: ReturnType<typeof createBrowserTool>,
): Promise<void> {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				kind: "freeform",
				prepareInput: prepareBrowserCodeModeInput,
				usage:
					'await tools.browser("help") // Logged-in local browser with web__run refs; ask before consequential external actions',
			}),
		]);
		pi.on("session_shutdown", () => registration.unregister());
	} catch (error) {
		if (isMissingCodeModeExtension(error)) return;
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
