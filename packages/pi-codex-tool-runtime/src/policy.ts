import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const CONFIGURED_PROVIDER_CHANNEL =
	"@howaboua/pi-codex-tool-runtime.configured-provider/v1";

interface ConfiguredProviderRequest {
	model: ExtensionContext["model"];
	allow(): void;
}

export function registerCodexToolProviderPolicy(
	pi: ExtensionAPI,
	allows: (model: ExtensionContext["model"]) => boolean,
): () => void {
	return pi.events.on(CONFIGURED_PROVIDER_CHANNEL, (value) => {
		if (!isConfiguredProviderRequest(value)) return;
		if (allows(value.model)) value.allow();
	});
}

export function isConfiguredCodexToolProvider(
	pi: ExtensionAPI,
	model: ExtensionContext["model"],
): boolean {
	let allowed = false;
	pi.events.emit(CONFIGURED_PROVIDER_CHANNEL, {
		model,
		allow() {
			allowed = true;
		},
	} satisfies ConfiguredProviderRequest);
	return allowed;
}

function isConfiguredProviderRequest(
	value: unknown,
): value is ConfiguredProviderRequest {
	return Boolean(
		value &&
			typeof value === "object" &&
			"model" in value &&
			"allow" in value &&
			typeof value.allow === "function",
	);
}
