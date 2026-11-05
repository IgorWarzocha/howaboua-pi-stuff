import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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

const IMAGE_GENERATION_PARAMETERS = Type.Object(
	{
		prompt: Type.String({
			description: "Include target aspect ratio and quality",
		}),
		output_format: Type.Optional(
			Type.Enum(OUTPUT_FORMATS, {
				description: "GIF/SVG generation only",
			}),
		),
		size: Type.Optional(
			Type.String({
				description: "auto or WIDTHxHEIGHT, multiples of 16",
			}),
		),
		gif: Type.Optional(
			Type.Object(
				{
					frame_count: Type.Optional(Type.Integer({ minimum: 2, maximum: 64 })),
					frame_duration_ms: Type.Optional(
						Type.Integer({ minimum: 20, maximum: 2000, multipleOf: 10 }),
					),
				},
				{
					additionalProperties: false,
					description: "Animated GIF; omit controls for API defaults",
				},
			),
		),
		transparent_background: Type.Optional(
			Type.Boolean({
				description:
					"True for transparency or cutouts; for edits preserve existing transparency unless asked to change it",
			}),
		),
		referenced_image_paths: Type.Optional(
			Type.Union([
				Type.Array(Type.String(), {
					description: "Local edit targets",
					maxItems: MAX_EDIT_IMAGES,
				}),
				Type.Null(),
			]),
		),
		num_last_images_to_include: Type.Optional(
			Type.Union([
				Type.Integer({
					description: "Smallest recent edit count",
					minimum: 1,
					maximum: MAX_EDIT_IMAGES,
				}),
				Type.Null(),
			]),
		),
	},
	{ additionalProperties: false },
);

const CODEX_IMAGE_GENERATION_PARAMETERS = Type.Omit(
	IMAGE_GENERATION_PARAMETERS,
	["output_format", "size", "gif"],
	{ additionalProperties: false },
);

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
