import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { codexToolProviderEnv, resolveCodexToolProvider } from "../../adapter/codex-tool-provider.js";
import { IMAGE_GENERATION_TOOL_NAME } from "../../adapter/activation/tool-set.js";
import { getBundledPathToolBinaryPath } from "../path/binary.js";
import { formatPathImagegenOutput, imageContentsFromPathImagegenOutput, pathImagegenOutputFromJson } from "../path/outputs.js";
import { renderTextWithImages } from "../path/rendering.js";
import { runBundledTool } from "../path/runner.js";
import { renderCodexToolCell } from "../../ui/tool-rendering/codex-tool-cell.js";
export const IMAGE_GENERATION_UNSUPPORTED_MESSAGE = "imagegen requires an image-capable OpenAI Codex-compatible Responses provider";
const IMAGE_GENERATION_PARAMETERS = Type.Object({
    prompt: Type.String(),
    action: Type.Optional(Type.Union([Type.Literal("generate"), Type.Literal("edit")], { description: "Default generate." })),
    images: Type.Optional(Type.Array(Type.String(), { description: "Edit inputs." })),
});
function supportsImageInputs(model) {
    return !Array.isArray(model?.input) || model.input.includes("image");
}
export function supportsNativeImageGeneration(model) {
    return (model?.provider ?? "").toLowerCase() === "openai-codex" && Boolean(model?.api?.includes("responses")) && supportsImageInputs(model);
}
function supportsExecutableImageGeneration(model, options) {
    return supportsNativeImageGeneration(model) || Boolean(options.allowConfiguredProvider?.(model));
}
async function executeRustImagegen(args, signal, ctx) {
    if (signal?.aborted)
        throw new Error("imagegen aborted");
    const binary = getBundledPathToolBinaryPath("imagegen");
    if (!binary)
        throw new Error(`imagegen binary is not bundled for ${process.platform}-${process.arch}`);
    const provider = await resolveCodexToolProvider(ctx);
    const child = await runBundledTool({
        binary,
        args: [JSON.stringify({ ...args, cwd: ctx.cwd })],
        cwd: ctx.cwd,
        env: codexToolProviderEnv(provider),
        signal,
        label: IMAGE_GENERATION_TOOL_NAME,
    });
    if (child.status !== 0)
        throw new Error((child.stderr || child.stdout || "imagegen failed").trim());
    const parsed = pathImagegenOutputFromJson(child.stdout);
    if (!parsed)
        throw new Error("imagegen returned output, but Pi could not parse it");
    return parsed;
}
export function createImageGenerationTool(options = {}) {
    const description = "Generate/edit images.";
    return {
        name: IMAGE_GENERATION_TOOL_NAME,
        label: IMAGE_GENERATION_TOOL_NAME,
        description,
        ...(options.promptSnippet === false ? {} : { promptSnippet: description }),
        parameters: IMAGE_GENERATION_PARAMETERS,
        prepareArguments: (args) => args,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            if (!supportsExecutableImageGeneration(ctx.model, options))
                throw new Error(IMAGE_GENERATION_UNSUPPORTED_MESSAGE);
            const details = await executeRustImagegen(params, signal, ctx);
            const imageContent = supportsImageInputs(ctx.model) ? imageContentsFromPathImagegenOutput(details) : [];
            return { content: [{ type: "text", text: formatPathImagegenOutput(details) }, ...imageContent], details };
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
export function registerImageGenerationTool(pi, options = {}) { pi.registerTool(createImageGenerationTool(options)); }
