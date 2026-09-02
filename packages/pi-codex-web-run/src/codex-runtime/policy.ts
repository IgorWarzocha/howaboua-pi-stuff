import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const CONFIGURED_PROVIDER_CHANNEL =
	"@howaboua/pi-codex-conversion.configured-provider/v1";

interface ConfiguredProviderRequest {
	model: ExtensionContext["model"];
	allow(): void;
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
