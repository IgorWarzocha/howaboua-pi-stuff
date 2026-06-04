import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, Text } from "@earendil-works/pi-tui";
import { isOpenAICodexModel } from "../adapter/codex-model.ts";

export const IMAGE_GENERATION_UNSUPPORTED_MESSAGE =
	"image_generation is only available with image-capable openai-codex models";
const IMAGE_GENERATION_LOCAL_EXECUTION_MESSAGE =
	"image_generation is a native openai-codex provider tool and should not execute locally";

const IMAGE_GENERATION_PARAMETERS = Type.Unsafe<Record<string, never>>({
	type: "object",
	additionalProperties: false,
});

interface FunctionToolPayload {
	type?: unknown | undefined;
	name?: unknown | undefined;
}

interface ResponsesPayload {
	tools?: unknown[] | undefined;
	[key: string]: unknown;
}

interface ResponsesImageGenerationTool {
	type: "image_generation";
	output_format: "png";
}

function supportsImageInputs(model: ExtensionContext["model"]): boolean {
	return Array.isArray(model?.input) && model.input.includes("image");
}

export function supportsNativeImageGeneration(model: ExtensionContext["model"]): boolean {
	return isOpenAICodexModel(model) && supportsImageInputs(model);
}

function isImageGenerationFunctionTool(tool: unknown): tool is FunctionToolPayload {
	return !!tool && typeof tool === "object" && (tool as FunctionToolPayload).type === "function" && (tool as FunctionToolPayload).name === "image_generation";
}

function createEmptyResultComponent(): Container {
	return new Container();
}

export function rewriteNativeImageGenerationTool(payload: unknown, model: ExtensionContext["model"], options: { force?: boolean | undefined } = {}): unknown {
	if ((!options.force && !supportsNativeImageGeneration(model)) || !payload || typeof payload !== "object") {
		return payload;
	}

	const tools = (payload as ResponsesPayload).tools;
	if (!Array.isArray(tools)) {
		return payload;
	}

	let rewritten = false;
	const nextTools = tools.map((tool) => {
		if (!isImageGenerationFunctionTool(tool)) {
			return tool;
		}
		rewritten = true;
		const nativeTool: ResponsesImageGenerationTool = {
			type: "image_generation",
			output_format: "png",
		};
		return nativeTool;
	});

	if (!rewritten) {
		return payload;
	}

	return {
		...(payload as ResponsesPayload),
		tools: nextTools,
	};
}

export function createImageGenerationTool(): ToolDefinition<typeof IMAGE_GENERATION_PARAMETERS> {
	const description =
		"Generate an image. Outputs are saved under `.pi/openai-codex-images/` and mirrored to `.pi/openai-codex-images/latest.png`.";
	return {
		name: "image_generation",
		label: "image_generation",
		description,
		promptSnippet: description,
		parameters: IMAGE_GENERATION_PARAMETERS,
		prepareArguments: () => ({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (!supportsNativeImageGeneration(ctx.model)) {
				throw new Error(IMAGE_GENERATION_UNSUPPORTED_MESSAGE);
			}
			throw new Error(IMAGE_GENERATION_LOCAL_EXECUTION_MESSAGE);
		},
		renderCall(_args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold("image_generation"))}`, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			if (!expanded) {
				return createEmptyResultComponent();
			}
			const textBlock = result.content.find((item) => item.type === "text");
			const text = textBlock?.type === "text" ? textBlock.text : "(no output)";
			return new Text(theme.fg("dim", text), 0, 0);
		},
	};
}

export function registerImageGenerationTool(pi: ExtensionAPI): void {
	pi.registerTool(createImageGenerationTool());
}
