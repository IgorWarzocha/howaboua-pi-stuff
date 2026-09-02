import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const IMAGE_GENERATION_TOOL_NAME = "imagegen";
export const IMAGE_GENERATION_UNSUPPORTED_MESSAGE =
	"imagegen requires an image-capable OpenAI Codex-compatible Responses provider";
export const IMAGE_MODEL = "gpt-image-2";
export const MAX_EDIT_IMAGES = 5;

export const IMAGE_GENERATION_PARAMETERS = Type.Object(
	{
		prompt: Type.String(),
		background: Type.Optional(
			StringEnum(["transparent", "opaque"] as const, {
				description: "Set transparent for native alpha output",
			}),
		),
		referenced_image_paths: Type.Optional(
			Type.Array(Type.String(), {
				description: "Local edit targets",
				maxItems: MAX_EDIT_IMAGES,
			}),
		),
		num_last_images_to_include: Type.Optional(
			Type.Integer({
				description: "Smallest recent edit count",
				minimum: 1,
				maximum: MAX_EDIT_IMAGES,
			}),
		),
	},
	{ additionalProperties: false },
);

export interface ImagegenArgs {
	prompt: string;
	background?: "transparent" | "opaque";
	referenced_image_paths?: string[];
	num_last_images_to_include?: number;
}

export interface ImageResponse {
	data: Array<{ b64_json: string }>;
	background?: string | null;
	quality?: string | null;
	size?: string | null;
}

export interface ImageGenerationToolOptions {
	allowConfiguredProvider?: (model: ExtensionContext["model"]) => boolean;
	allowCodexProviderFallback?: boolean;
	customRendering?: boolean;
	promptSnippet?: boolean;
}

export function supportsImageInputs(model: ExtensionContext["model"]): boolean {
	return !Array.isArray(model?.input) || model.input.includes("image");
}

function supportsNativeImageGeneration(
	model: ExtensionContext["model"],
): boolean {
	const api = (model?.api ?? "").trim().toLowerCase();
	return (
		supportsImageInputs(model) &&
		api.includes("responses") &&
		((model?.provider ?? "").trim().toLowerCase() === "openai-codex" ||
			api === "openai-codex-responses")
	);
}

export function supportsExecutableImageGeneration(
	model: ExtensionContext["model"],
	options: ImageGenerationToolOptions,
): boolean {
	return (
		supportsNativeImageGeneration(model) ||
		Boolean(options.allowConfiguredProvider?.(model)) ||
		options.allowCodexProviderFallback === true
	);
}
