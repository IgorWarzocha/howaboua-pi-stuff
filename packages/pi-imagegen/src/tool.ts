import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	IMAGE_GENERATION_PARAMETERS,
	IMAGE_GENERATION_TOOL_NAME,
	IMAGE_GENERATION_UNSUPPORTED_MESSAGE,
	type ImageGenerationToolOptions,
	supportsExecutableImageGeneration,
	supportsImageInputs,
} from "./contract.js";
import { executeCodexImageGeneration } from "./execute.js";
import {
	formatImagegenOutput,
	type ImagegenOutput,
	imageContentsFromImagegenOutput,
} from "./output.js";
import { renderTextWithImages, renderToolCell } from "./render.js";

export function createImageGenerationTool(
	options: ImageGenerationToolOptions = {},
): ToolDefinition<typeof IMAGE_GENERATION_PARAMETERS, ImagegenOutput> {
	return {
		name: IMAGE_GENERATION_TOOL_NAME,
		label: IMAGE_GENERATION_TOOL_NAME,
		description:
			"Generate images or edit local or recent images. Omit selectors to generate",
		...(options.promptSnippet === false
			? {}
			: { promptSnippet: "Generate and edit images" }),
		parameters: IMAGE_GENERATION_PARAMETERS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!supportsExecutableImageGeneration(ctx.model, options))
				throw new Error(IMAGE_GENERATION_UNSUPPORTED_MESSAGE);
			const details = await executeCodexImageGeneration(
				params,
				ctx,
				signal,
				options,
			);
			const imageContent = supportsImageInputs(ctx.model)
				? imageContentsFromImagegenOutput(details)
				: [];
			return {
				content: [
					{ type: "text", text: formatImagegenOutput(details) },
					...imageContent,
				],
				details,
			};
		},
		...(options.customRendering === false
			? {}
			: {
					renderCall(args, theme) {
						return renderToolCell(
							"Generated Image:",
							typeof args.prompt === "string" ? args.prompt : undefined,
							theme,
						);
					},
					renderResult(result, _options, theme) {
						const textBlock = result.content.find(
							(item) => item.type === "text",
						);
						const text = theme.fg(
							"dim",
							textBlock?.type === "text" ? textBlock.text : "(no output)",
						);
						return result.content.some((item) => item.type === "image")
							? renderTextWithImages(text, result.content, theme)
							: new Text(text, 0, 0);
					},
				}),
	};
}
