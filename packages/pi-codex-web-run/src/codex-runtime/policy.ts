import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexToolProviderResolver } from "../contract.js";
import { resolveAuthModel } from "./resolve.js";
import type { CodexToolProvider } from "./types.js";

const PROVIDER_RESOLVER_CHANNEL =
	"@howaboua/pi-codex-conversion.provider-resolver/v1";

interface ProviderResolverRequest {
	use(resolver: CodexToolProviderResolver): void;
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
	// Conversation-provider opt-ins do not advertise Codex tool endpoints.
	return resolver?.({ ...ctx, model: resolveAuthModel(ctx) });
}
