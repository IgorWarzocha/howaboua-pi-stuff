import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	CodexDeveloperCustomMessage,
	CodexDeveloperMessageOptions,
	trySendCodexDeveloperCustomMessage,
} from "@howaboua/pi-codex-conversion/developer-messages";

const senders = new WeakMap<
	ExtensionAPI,
	typeof trySendCodexDeveloperCustomMessage
>();
const PACKAGE = "@howaboua/pi-codex-conversion";
const MODULE = `${PACKAGE}/developer-messages`;

export async function registerDeveloperDelivery(
	pi: ExtensionAPI,
): Promise<void> {
	try {
		const api = await import(
			"@howaboua/pi-codex-conversion/developer-messages"
		);
		if (typeof api.trySendCodexDeveloperCustomMessage === "function")
			senders.set(pi, api.trySendCodexDeveloperCustomMessage);
	} catch (error) {
		if (!isUnavailable(error)) throw error;
	}
}

export function sendPolicyMessage(
	pi: ExtensionAPI,
	message: CodexDeveloperCustomMessage,
	options: CodexDeveloperMessageOptions,
): void {
	if (senders.get(pi)?.(pi, message, options)) return;
	pi.sendMessage(message, options);
}

function isUnavailable(error: unknown): boolean {
	if (
		!error ||
		typeof error !== "object" ||
		!("code" in error) ||
		!("message" in error) ||
		typeof error.message !== "string"
	)
		return false;
	if (
		error.code === "ERR_MODULE_NOT_FOUND" ||
		error.code === "MODULE_NOT_FOUND"
	) {
		const missing = error.message.match(
			/Cannot find (?:package|module) ['"]([^'"]+)['"]/,
		)?.[1];
		const normalized = missing?.replaceAll("\\", "/").replace(/\.js$/, "");
		return (
			missing === PACKAGE ||
			normalized === MODULE ||
			normalized?.endsWith(`/${MODULE}`) === true
		);
	}
	return (
		(error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
			error.code === "ERR_UNSUPPORTED_DIR_IMPORT") &&
		(error.message.includes(MODULE) ||
			(error.message.includes("Package subpath './developer-messages'") &&
				error.message.includes(PACKAGE)))
	);
}
