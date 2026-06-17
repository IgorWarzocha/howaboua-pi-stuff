import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, Image, Spacer, Text } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { codexToolProviderEnv, resolveCodexToolProvider } from "../../adapter/codex-tool-provider.ts";
import { IMAGE_GENERATION_TOOL_NAME } from "../../adapter/activation/tool-set.ts";
import { getBundledPathToolBinaryPath } from "../path/binary.ts";
import { formatPathImagegenOutput, imageContentsFromPathImagegenOutput, pathImagegenOutputFromJson } from "../path/outputs.ts";
import { runBundledTool } from "../path/runner.ts";
import { renderCodexToolCell } from "../../ui/tool-rendering/codex-tool-cell.ts";

export const IMAGE_GENERATION_UNSUPPORTED_MESSAGE = "imagegen requires an image-capable OpenAI Codex-compatible Responses provider";
const IMAGE_GENERATION_PARAMETERS = Type.Object({
	prompt: Type.String(),
	action: Type.Optional(Type.Union([Type.Literal("generate"), Type.Literal("edit")], { description: "Default generate." })),
	images: Type.Optional(Type.Array(Type.String(), { description: "Edit inputs." })),
});

type ImagegenArgs = {
	prompt: string;
	action?: "generate" | "edit" | undefined;
	images?: string[] | undefined;
};

type SavedImage = { path: string; absolute_path: string; latest_path?: string; latest_absolute_path?: string };

type ImagegenDetails = { path: string; latest_path: string; images: SavedImage[]; background?: string | undefined; quality?: string | undefined; size?: string | undefined };

function supportsImageInputs(model: ExtensionContext["model"]): boolean {
	return !Array.isArray(model?.input) || model.input.includes("image");
}

export function supportsNativeImageGeneration(model: ExtensionContext["model"]): boolean {
	return (model?.provider ?? "").toLowerCase() === "openai-codex" && Boolean(model?.api?.includes("responses")) && supportsImageInputs(model);
}

function supportsExecutableImageGeneration(model: ExtensionContext["model"], options: ImageGenerationToolOptions): boolean {
	return supportsNativeImageGeneration(model) || Boolean(options.allowConfiguredProvider?.(model));
}

async function executeRustImagegen(args: ImagegenArgs, signal: AbortSignal | undefined, ctx: ExtensionContext): Promise<ImagegenDetails> {
	if (signal?.aborted) throw new Error("imagegen aborted");
	const binary = getBundledPathToolBinaryPath("imagegen");
	if (!binary) throw new Error(`imagegen binary is not bundled for ${process.platform}-${process.arch}`);
	const provider = await resolveCodexToolProvider(ctx);
	const child = await runBundledTool({
		binary,
		args: [JSON.stringify({ ...args, cwd: ctx.cwd })],
		cwd: ctx.cwd,
		env: codexToolProviderEnv(provider),
		signal,
		label: IMAGE_GENERATION_TOOL_NAME,
	});
	if (child.status !== 0) throw new Error((child.stderr || child.stdout || "imagegen failed").trim());
	const parsed = pathImagegenOutputFromJson(child.stdout);
	if (!parsed) throw new Error("imagegen returned output, but Pi could not parse it");
	return parsed as ImagegenDetails;
}

function renderResultWithImages(text: string, details: ImagegenDetails, theme: { fg(role: string, text: string): string }): Container {
	const box = new Container();
	box.addChild(new Text(text, 0, 0));
	for (const image of details.images) {
		try {
			box.addChild(new Spacer(1));
			box.addChild(new Image(readFileSync(image.absolute_path).toString("base64"), "image/png", { fallbackColor: (value) => theme.fg("dim", value) }, { maxWidthCells: 60 }));
		} catch {}
	}
	return box;
}

export interface ImageGenerationToolOptions {
	allowConfiguredProvider?: ((model: ExtensionContext["model"]) => boolean) | undefined;
	customRendering?: boolean | undefined;
	promptSnippet?: boolean | undefined;
}

export function createImageGenerationTool(options: ImageGenerationToolOptions = {}): ToolDefinition<typeof IMAGE_GENERATION_PARAMETERS, ImagegenDetails> {
	const description = "Generate/edit images.";
	return {
		name: IMAGE_GENERATION_TOOL_NAME,
		label: IMAGE_GENERATION_TOOL_NAME,
		description,
		...(options.promptSnippet === false ? {} : { promptSnippet: description }),
		parameters: IMAGE_GENERATION_PARAMETERS,
		prepareArguments: (args) => args as any,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!supportsExecutableImageGeneration(ctx.model, options)) throw new Error(IMAGE_GENERATION_UNSUPPORTED_MESSAGE);
			const details = await executeRustImagegen(params, signal, ctx);
			const imageContent = supportsImageInputs(ctx.model) ? imageContentsFromPathImagegenOutput(details) : [];
			return { content: [{ type: "text", text: formatPathImagegenOutput(details) }, ...imageContent], details };
		},
		...(options.customRendering === false ? {} : {
		renderCall(args, theme) { return renderCodexToolCell("Generated Image:", typeof args.prompt === "string" ? args.prompt : undefined, theme); },
		renderResult(result, _options, theme) {
			const textBlock = result.content.find((item) => item.type === "text");
			const text = theme.fg("dim", textBlock?.type === "text" ? textBlock.text : "(no output)");
			return result.details ? renderResultWithImages(text, result.details, theme) : new Text(text, 0, 0);
		},
		}),
	};
}

export function registerImageGenerationTool(pi: ExtensionAPI, options: ImageGenerationToolOptions = {}): void { pi.registerTool(createImageGenerationTool(options)); }
