import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	arr,
	bool,
	int,
	nul,
	obj,
	oneOf,
	opt,
	str,
	union,
} from "@earendil-works/pi-schema";
import type { CodexToolProvider } from "./codex-runtime/types.js";

export const IMAGE_GENERATION_TOOL_NAME = "imagegen";
export const IMAGE_CONTEXT_GUIDANCE =
	"Stateless: supply prior/reference images via paths or recent count; earlier calls are not remembered";
export const IMAGE_GENERATION_UNSUPPORTED_MESSAGE =
	"imagegen requires an image-capable OpenAI Codex-compatible Responses provider";
export const IMAGE_MODEL = "gpt-image-2.5";
export const MAX_EDIT_IMAGES = 5;
const OUTPUT_FORMATS = ["png", "jpeg", "webp", "gif", "svg"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const IMAGE_GENERATION_PROPERTIES = {
	prompt: str({
		description: "Include target aspect ratio and quality",
	}),
	output_format: opt({
		...oneOf(OUTPUT_FORMATS, {
			description: "GIF/SVG generation only",
		}),
		type: "string",
	}),
	size: opt(
		str({
			description: "auto or WIDTHxHEIGHT, multiples of 16",
		}),
	),
	gif: opt(
		obj(
			{
				frame_count: opt(int({ minimum: 2, maximum: 64 })),
				frame_duration_ms: opt(
					int({ minimum: 20, maximum: 2000, multipleOf: 10 }),
				),
			},
			{
				open: false,
				description: "Animated GIF; omit controls for API defaults",
			},
		),
	),
	transparent_background: opt(
		bool({
			description:
				"True for transparency or cutouts; for edits preserve existing transparency unless asked to change it",
		}),
	),
	referenced_image_paths: opt(
		union([
			arr(str(), {
				description: "Local edit targets",
				maxItems: MAX_EDIT_IMAGES,
			}),
			nul(),
		]),
	),
	num_last_images_to_include: opt(
		union([
			int({
				description: "Smallest recent edit count",
				minimum: 1,
				maximum: MAX_EDIT_IMAGES,
			}),
			nul(),
		]),
	),
};

const IMAGE_GENERATION_PARAMETERS = obj(IMAGE_GENERATION_PROPERTIES);
const CODEX_IMAGE_GENERATION_PARAMETERS = obj({
	prompt: IMAGE_GENERATION_PROPERTIES.prompt,
	transparent_background: IMAGE_GENERATION_PROPERTIES.transparent_background,
	referenced_image_paths: IMAGE_GENERATION_PROPERTIES.referenced_image_paths,
	num_last_images_to_include:
		IMAGE_GENERATION_PROPERTIES.num_last_images_to_include,
});

export function imageGenerationParameters(access: "codex" | "openai") {
	return access === "openai"
		? IMAGE_GENERATION_PARAMETERS
		: CODEX_IMAGE_GENERATION_PARAMETERS;
}

export interface ImagegenArgs {
	prompt: string;
	output_format?: OutputFormat;
	size?: string;
	gif?: { frame_count?: number; frame_duration_ms?: number };
	transparent_background?: boolean;
	referenced_image_paths?: string[] | null;
	num_last_images_to_include?: number | null;
}

export interface ImageResponse {
	data: Array<{ b64_json: string }>;
	background?: string | null;
	quality?: string | null;
	size?: string | null;
}

export type CodexToolProviderResolver = (
	ctx: ExtensionContext,
) => Promise<CodexToolProvider | undefined>;

export interface ImageGenerationToolOptions {
	allowConfiguredProvider?: (model: ExtensionContext["model"]) => boolean;
	resolveProvider?: CodexToolProviderResolver;
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
