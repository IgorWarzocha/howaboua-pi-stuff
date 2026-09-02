import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexToolProviderResolver } from "../contract.js";
import type { CodexToolProvider } from "./types.js";

const CONFIGURED_PROVIDER_CHANNEL =
	"@howaboua/pi-codex-conversion.configured-provider/v1";
const PROVIDER_RESOLVER_CHANNEL =
	"@howaboua/pi-codex-conversion.provider-resolver/v1";

interface ConfiguredProviderRequest {
	model: ExtensionContext["model"];
	allow(): void;
}

interface ProviderResolverRequest {
	use(resolver: CodexToolProviderResolver): void;
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

export async function resolveHostedCodexToolProvider(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<CodexToolProvider | undefined> {
	let resolver: CodexToolProviderResolver | undefined;
	pi.events.emit(PROVIDER_RESOLVER_CHANNEL, {
		use(candidate) {
			resolver ??= candidate;
		},
	} satisfies ProviderResolverRequest);
	return resolver?.(ctx);
}
