import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Model = ExtensionContext["model"];

export function supportsViewImageInputs(model: Model): boolean {
	return Array.isArray(model?.input) && model.input.includes("image");
}
