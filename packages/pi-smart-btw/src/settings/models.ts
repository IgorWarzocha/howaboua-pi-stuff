import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { splitModelRef } from "../config.js";

const FALLBACK_REF = "openai-codex/gpt-5.6-luna";

export function modelRef(provider: string, modelId: string) {
	return `${provider}/${modelId}`;
}

function registryPairs(ctx: ExtensionContext) {
	return ctx.modelRegistry.getAvailable().map((m) => ({
		provider: m.provider,
		modelId: m.id,
		ref: modelRef(m.provider, m.id),
	}));
}

export function listProviders(ctx: ExtensionContext): string[] {
	const set = new Set<string>();
	for (const p of registryPairs(ctx)) set.add(p.provider);
	return [...set].sort((a, b) => a.localeCompare(b));
}

export function listModelIdsForProvider(
	ctx: ExtensionContext,
	provider: string,
): string[] {
	const ids = registryPairs(ctx)
		.filter((p) => p.provider === provider)
		.map((p) => p.modelId);
	return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export function listProviderModelRefs(ctx: ExtensionContext): string[] {
	return registryPairs(ctx)
		.map((p) => p.ref)
		.sort((a, b) => a.localeCompare(b));
}

export function resolveProviderModel(
	ctx: ExtensionContext,
	provider: string,
	modelId: string,
): { provider: string; modelId: string } {
	const pairs = registryPairs(ctx);
	if (pairs.length === 0) return splitModelRef(FALLBACK_REF);

	const p = provider.trim();
	const id = modelId.trim();
	const exact = pairs.find((x) => x.provider === p && x.modelId === id);
	if (exact) return { provider: exact.provider, modelId: exact.modelId };

	const forProvider = pairs.filter((x) => x.provider === p);
	if (forProvider.length > 0)
		return {
			provider: forProvider[0]!.provider,
			modelId: forProvider[0]!.modelId,
		};

	const legacy =
		typeof provider === "string" && provider.includes("/") ? provider : "";
	if (legacy) {
		const slash = legacy.indexOf("/");
		const lp = legacy.slice(0, slash);
		const lid = legacy.slice(slash + 1);
		const match = pairs.find((x) => x.provider === lp && x.modelId === lid);
		if (match) return { provider: match.provider, modelId: match.modelId };
	}

	return { provider: pairs[0]!.provider, modelId: pairs[0]!.modelId };
}

export function isRegistryPair(
	ctx: ExtensionContext,
	provider: string,
	modelId: string,
): boolean {
	return registryPairs(ctx).some(
		(p) => p.provider === provider.trim() && p.modelId === modelId.trim(),
	);
}
