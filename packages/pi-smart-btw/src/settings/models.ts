import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const FALLBACK_MODELS = [
	"openai-codex/gpt-5.4-mini",
	"openai-codex/gpt-5.3-codex-spark",
	"openai-codex/gpt-5.4",
	"google/gemini-2.5-flash",
] as const;

export function modelRef(provider: string, id: string) {
	return `${provider}/${id}`;
}

export function listModelOptions(ctx: ExtensionContext): string[] {
	const available = ctx.modelRegistry.getAvailable();
	const refs = available.map((m) => modelRef(m.provider, m.id));
	refs.sort((a, b) => a.localeCompare(b));
	const set = new Set<string>(refs);
	for (const fallback of FALLBACK_MODELS) set.add(fallback);
	return [...set];
}
