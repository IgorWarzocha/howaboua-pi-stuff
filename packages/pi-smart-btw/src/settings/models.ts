import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { modelRef, splitModelRef } from "../config.js";

const FALLBACK = splitModelRef("openai-codex/gpt-5.4-mini");

export function listProviders(ctx: ExtensionContext): string[] {
	const set = new Set<string>([FALLBACK.provider]);
	for (const model of ctx.modelRegistry.getAvailable()) set.add(model.provider);
	return [...set].sort((a, b) => a.localeCompare(b));
}

export function listModelIdsForProvider(
	ctx: ExtensionContext,
	provider: string,
): string[] {
	const set = new Set<string>();
	for (const model of ctx.modelRegistry.getAvailable()) {
		if (model.provider === provider) set.add(model.id);
	}
	if (set.size === 0 && provider === FALLBACK.provider)
		set.add(FALLBACK.modelId);
	return [...set].sort((a, b) => a.localeCompare(b));
}

export function ensureProviderModel(
	ctx: ExtensionContext,
	provider: string,
	modelId: string,
): { provider: string; modelId: string } {
	let p = provider.trim() || FALLBACK.provider;
	let id = modelId.trim();
	const ids = listModelIdsForProvider(ctx, p);
	if (!id || !ids.includes(id)) id = ids[0] ?? FALLBACK.modelId;
	if (!listProviders(ctx).includes(p)) {
		p = FALLBACK.provider;
		id = listModelIdsForProvider(ctx, p)[0] ?? FALLBACK.modelId;
	}
	return { provider: p, modelId: id };
}

export { modelRef };
