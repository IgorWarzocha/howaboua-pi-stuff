import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { codexToolProviderEnv, resolveCodexToolProvider } from "../../adapter/codex-tool-provider.ts";
import { IMAGE_GENERATION_TOOL_NAME } from "../../adapter/activation/tool-set.ts";
import { supportsNativeImageGeneration } from "../../adapter/tool-support.ts";
import { getBundledToolBinaryPath } from "../native/binary.ts";
import { formatImagegenOutput, imageContentsFromImagegenOutput, imagegenOutputFromJson, type ImagegenOutput } from "./output.ts";
import { renderTextWithImages } from "../../ui/tool-rendering/media.ts";
import { runBundledTool } from "../native/runner.ts";
import { renderCodexToolCell } from "../../ui/tool-rendering/codex-tool-cell.ts";
import { recentConversationImageUrls } from "./history.ts";

export const IMAGE_GENERATION_UNSUPPORTED_MESSAGE = "imagegen requires an image-capable OpenAI Codex-compatible Responses provider";
const IMAGE_GENERATION_PARAMETERS = Type.Object({
	prompt: Type.String(),
	referenced_image_paths: Type.Optional(Type.Array(Type.String(), { description: "Local edit targets", maxItems: 5 })),
	num_last_images_to_include: Type.Optional(Type.Integer({ description: "Smallest recent count covering pathless edit targets", minimum: 1, maximum: 5 })),
}, { additionalProperties: false });

type ImagegenArgs = {
	prompt: string;
	referenced_image_paths?: string[] | undefined;
	num_last_images_to_include?: number | undefined;
};

function supportsImageInputs(model: ExtensionContext["model"]): boolean {
	return !Array.isArray(model?.input) || model.input.includes("image");
}

function supportsExecutableImageGeneration(model: ExtensionContext["model"], options: ImageGenerationToolOptions): boolean {
	return supportsNativeImageGeneration(model)
		|| Boolean(options.allowConfiguredProvider?.(model))
		|| options.allowCodexProviderFallback === true;
}

async function executeRustImagegen(args: ImagegenArgs, signal: AbortSignal | undefined, ctx: ExtensionContext, options: ImageGenerationToolOptions): Promise<ImagegenOutput> {
	if (signal?.aborted) throw new Error("imagegen aborted");
	const binary = getBundledToolBinaryPath("imagegen", {}, options.customRustBinariesDir);
	if (!binary) throw new Error(`imagegen binary is not bundled for ${process.platform}-${process.arch}`);
	if ((args.referenced_image_paths?.length ?? 0) > 0 && args.num_last_images_to_include !== undefined) {
		throw new Error("provide only one of `referenced_image_paths` or `num_last_images_to_include`");
	}
	const recentImages = args.num_last_images_to_include === undefined
		? undefined
		: recentConversationImageUrls(ctx.sessionManager.buildContextEntries(), args.num_last_images_to_include);
	if (args.num_last_images_to_include !== undefined && recentImages?.length !== args.num_last_images_to_include) {
		throw new Error(
			`requested the last ${args.num_last_images_to_include} conversation images, but only ${recentImages?.length ?? 0} were available`,
		);
	}
	const provider = await resolveCodexToolProvider(ctx, options.allowConfiguredProvider);
	const child = await runBundledTool({
		binary,
		args: [],
		stdin: JSON.stringify({
			...args,
			...(recentImages ? { recent_images: recentImages } : {}),
			cwd: ctx.cwd,
		}),
		cwd: ctx.cwd,
		env: codexToolProviderEnv(provider),
		signal,
		label: IMAGE_GENERATION_TOOL_NAME,
	});
	if (child.status !== 0) throw new Error((child.stderr || child.stdout || "imagegen failed").trim());
	const parsed = imagegenOutputFromJson(child.stdout);
	if (!parsed) throw new Error("imagegen returned output, but Pi could not parse it");
	return parsed;
}

export interface ImageGenerationToolOptions {
	customRustBinariesDir?: string | undefined;
	allowConfiguredProvider?: ((model: ExtensionContext["model"]) => boolean) | undefined;
	allowCodexProviderFallback?: boolean | undefined;
	customRendering?: boolean | undefined;
	promptSnippet?: boolean | undefined;
}

export function createImageGenerationTool(options: ImageGenerationToolOptions = {}): ToolDefinition<typeof IMAGE_GENERATION_PARAMETERS, ImagegenOutput> {
	const description = "Generate images or edit local or recent images. Omit selectors to generate";
	return {
		name: IMAGE_GENERATION_TOOL_NAME,
		label: IMAGE_GENERATION_TOOL_NAME,
		description,
		...(options.promptSnippet === false ? {} : { promptSnippet: "Generate and edit images" }),
		parameters: IMAGE_GENERATION_PARAMETERS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!supportsExecutableImageGeneration(ctx.model, options)) throw new Error(IMAGE_GENERATION_UNSUPPORTED_MESSAGE);
			const details = await executeRustImagegen(params, signal, ctx, options);
			const imageContent = supportsImageInputs(ctx.model) ? imageContentsFromImagegenOutput(details) : [];
			return { content: [{ type: "text", text: formatImagegenOutput(details) }, ...imageContent], details };
		},
		...(options.customRendering === false ? {} : {
		renderCall(args, theme) { return renderCodexToolCell("Generated Image:", typeof args.prompt === "string" ? args.prompt : undefined, theme); },
		renderResult(result, _options, theme) {
			const textBlock = result.content.find((item) => item.type === "text");
			const text = theme.fg("dim", textBlock?.type === "text" ? textBlock.text : "(no output)");
			return result.content.some((item) => item.type === "image") ? renderTextWithImages(text, result.content, theme) : new Text(text, 0, 0);
		},
		}),
	};
}

export function registerImageGenerationTool(pi: ExtensionAPI, options: ImageGenerationToolOptions = {}): void { pi.registerTool(createImageGenerationTool(options)); }
