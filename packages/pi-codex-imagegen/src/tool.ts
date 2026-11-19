import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Static } from "@earendil-works/pi-schema";
import { Text } from "@earendil-works/pi-tui";
import {
	IMAGE_GENERATION_TOOL_NAME,
	IMAGE_GENERATION_UNSUPPORTED_MESSAGE,
	type ImageGenerationToolOptions,
	imageGenerationParameters,
	supportsExecutableImageGeneration,
	supportsImageInputs,
} from "./contract.js";
import { generateImageArtifacts } from "./execute.js";
import { formatImagegenOutput, type ImagegenOutput } from "./output.js";
import { renderToolCell } from "./render.js";
import { readImagegenSettings } from "./settings.js";

export function createImageGenerationTool(
	options: ImageGenerationToolOptions = {},
): ToolDefinition<
	ReturnType<typeof imageGenerationParameters>,
	ImagegenOutput
> {
	return {
		name: IMAGE_GENERATION_TOOL_NAME,
		label: IMAGE_GENERATION_TOOL_NAME,
		description: "Generate or edit images",
		...(options.promptSnippet === false
			? {}
			: { promptSnippet: "Generate/edit" }),
		parameters: imageGenerationParameters(readImagegenSettings().access),
		async execute(
			toolCallId,
			params: Static<ReturnType<typeof imageGenerationParameters>>,
			signal,
			_onUpdate,
			ctx,
		) {
			if (
				!supportsExecutableImageGeneration(ctx.model, options) &&
				readImagegenSettings().access !== "openai"
			)
				throw new Error(IMAGE_GENERATION_UNSUPPORTED_MESSAGE);
			const { details, imageContent } = await generateImageArtifacts(
				params,
				ctx,
				signal,
				supportsImageInputs(ctx.model),
				options,
				toolCallId,
			);
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
					renderCall(args, theme, context) {
						return renderToolCell(
							context.isPartial
								? "Generating image"
								: context.isError
									? "Image generation failed"
									: "Generated image",
							args &&
								typeof args === "object" &&
								"prompt" in args &&
								typeof args.prompt === "string"
								? args.prompt
								: undefined,
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
						return new Text(text, 0, 0);
					},
				}),
	};
}
