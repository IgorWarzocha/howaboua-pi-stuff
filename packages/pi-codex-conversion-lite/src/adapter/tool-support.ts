import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Model = ExtensionContext["model"];

export function supportsViewImageInputs(model: Model): boolean {
	return Array.isArray(model?.input) && model.input.includes("image");
}

export function supportsNativeWebSearch(model: Model): boolean {
	return (model?.provider ?? "").toLowerCase() === "openai-codex" && Boolean(model?.api?.includes("responses"));
}

export function supportsNativeImageGeneration(model: Model): boolean {
	const supportsImages = !Array.isArray(model?.input) || model.input.includes("image");
	return (model?.provider ?? "").toLowerCase() === "openai-codex"
		&& Boolean(model?.api?.includes("responses"))
		&& supportsImages;
}
