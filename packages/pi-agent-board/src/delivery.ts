import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	CodexContextBriefingHandler,
	CodexDeveloperCustomMessage,
	CodexDeveloperMessageOptions,
} from "@howaboua/pi-codex-conversion/developer-messages";

type Delivery =
	typeof import("@howaboua/pi-codex-conversion/developer-messages");
let optionalDelivery: Promise<Delivery | undefined> | undefined;

function loadDelivery() {
	return (optionalDelivery ??= import(
		"@howaboua/pi-codex-conversion/developer-messages"
	).catch((error) => {
		if (isMissingOptionalModule(error, "developer-messages")) return undefined;
		throw error;
	}));
}

export function isMissingOptionalModule(error: unknown, subpath: string) {
	if (!(error instanceof Error) || !("code" in error)) return false;
	const name = "@howaboua/pi-codex-conversion";
	if (error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED")
		return (
			error.message.includes(name) && error.message.includes(`./${subpath}`)
		);
	if (
		error.code !== "ERR_MODULE_NOT_FOUND" &&
		error.code !== "MODULE_NOT_FOUND"
	)
		return false;
	const missing = error.message.match(
		/Cannot find (?:package|module) ['"]([^'"]+)['"]/,
	)?.[1];
	return missing === name || missing === `${name}/${subpath}`;
}

let delivery: Delivery | undefined;
export async function initializeDelivery() {
	delivery = await loadDelivery();
}

export function registerInferenceBriefing(
	pi: ExtensionAPI,
	handler: CodexContextBriefingHandler,
) {
	let unregister: (() => void) | undefined;
	const ready = loadDelivery().then((api) => {
		delivery = api;
		unregister = api?.registerCodexContextBriefing?.(pi, handler);
	});
	pi.on("session_shutdown", () => unregister?.());
	return {
		ready,
		hosted: () => delivery?.hasCodexContextBriefingHost?.(pi) ?? false,
		get outdated() {
			return Boolean(delivery && !delivery.registerCodexContextBriefing);
		},
	};
}

export function sendPolicyMessage(
	pi: ExtensionAPI,
	message: CodexDeveloperCustomMessage,
	options: CodexDeveloperMessageOptions,
) {
	if (delivery?.trySendCodexDeveloperCustomMessage?.(pi, message, options))
		return;
	pi.sendMessage(
		message,
		options.deliverAs === "nextTurn"
			? { ...options, deliverAs: "steer" }
			: options,
	);
}
