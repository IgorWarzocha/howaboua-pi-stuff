import {} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { parseSSE } from "../../providers/openai-codex/sse.js";
import { codexToolProviderHeaders, resolveCodexResponsesUrl, resolveCodexToolProvider } from "../../adapter/codex-tool-provider.js";
import { getBundledPathToolBinaryPath } from "../path/binary.js";
import { imageContentFromCodexViewImageOutput, imageContentsFromPathToolDetails } from "../path/outputs.js";
import { renderTextWithImages } from "../path/rendering.js";
import { runBundledTool } from "../path/runner.js";
import { renderCodexToolCell } from "../../ui/tool-rendering/codex-tool-cell.js";
const VIEW_IMAGE_UNSUPPORTED_MESSAGE = "view_image is not allowed because you do not support image inputs";
const IMAGE_DESCRIPTION_MODEL = "gpt-5.6-luna";
const IMAGE_DESCRIPTION_PROMPT = "Describe this image in detail. Output only the image description, no other commentary.";
function createViewImageParameters() {
    const properties = { path: Type.String() };
    return Type.Object(properties);
}
export function parseViewImageParams(params) {
    if (!params || typeof params !== "object" || !("path" in params) || typeof params.path !== "string") {
        throw new Error("view_image requires a string 'path' parameter");
    }
    if ("detail" in params) {
        const rawDetail = params.detail;
        if (rawDetail !== null && rawDetail !== undefined && typeof rawDetail !== "string") {
            throw new Error("view_image.detail must be a string when provided");
        }
        if (typeof rawDetail === "string" && rawDetail !== "original") {
            throw new Error(`view_image.detail only supports \`original\`, got \`${rawDetail}\``);
        }
    }
    return { path: params.path };
}
function prepareViewImageArguments(args) {
    if (!args || typeof args !== "object") {
        return args;
    }
    const record = args;
    const prepared = { ...record };
    if (!("path" in prepared)) {
        if ("file_path" in prepared) {
            prepared["path"] = prepared["file_path"];
        }
        else if ("image_path" in prepared) {
            prepared["path"] = prepared["image_path"];
        }
    }
    return prepared;
}
async function executeRustViewImageContent(params, cwd, signal) {
    const binary = getBundledPathToolBinaryPath("view_image");
    if (!binary) {
        throw new Error(`view_image binary is not bundled for ${process.platform}-${process.arch}`);
    }
    const child = await runBundledTool({
        binary,
        args: [JSON.stringify(params)],
        cwd,
        signal,
        label: "view_image",
    });
    if (child.status !== 0) {
        throw new Error((child.stderr || child.stdout || "view_image failed").trim());
    }
    const imageContent = imageContentFromCodexViewImageOutput(child.stdout);
    if (!imageContent) {
        throw new Error("view_image expected an image file. Use exec_command for text files.");
    }
    return imageContent;
}
async function executeRustViewImage(params, cwd, signal) {
    const imageContent = await executeRustViewImageContent(params, cwd, signal);
    return { content: [imageContent], details: { pathTool: { viewImage: true } } };
}
function extractOutputText(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const record = value;
    const outputText = record["output_text"];
    if (typeof outputText === "string" && outputText.trim())
        return outputText;
    const output = record["output"];
    if (!Array.isArray(output))
        return undefined;
    const parts = [];
    for (const item of output) {
        if (!item || typeof item !== "object")
            continue;
        const content = item["content"];
        if (!Array.isArray(content))
            continue;
        for (const block of content) {
            if (!block || typeof block !== "object")
                continue;
            const text = block["text"];
            if (typeof text === "string")
                parts.push(text);
        }
    }
    const text = parts.join("").trim();
    return text || undefined;
}
function isUsableDescriptionModel(model) {
    return (model?.provider ?? "").toLowerCase() === "openai-codex"
        && Boolean(model?.api?.includes("responses"))
        && (!Array.isArray(model?.input) || model.input.includes("image"));
}
function modelVersionScore(id) {
    return [...id.matchAll(/\d+/g)].map((match) => Number.parseInt(match[0], 10));
}
function compareModelIdsDescending(left, right) {
    const a = modelVersionScore(left);
    const b = modelVersionScore(right);
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
        const diff = (b[index] ?? 0) - (a[index] ?? 0);
        if (diff !== 0)
            return diff;
    }
    return right.localeCompare(left);
}
export function resolveImageDescriptionModel(ctx) {
    const registry = ctx.modelRegistry;
    const models = [...(registry.getAvailable?.() ?? []), ...(registry.getAll?.() ?? [])]
        .filter(isUsableDescriptionModel);
    const mini = models
        .filter((model) => model?.id?.toLowerCase().includes("mini"))
        .sort((left, right) => compareModelIdsDescending(left.id, right.id))[0];
    if (mini?.id)
        return mini.id;
    const direct = registry.find?.("openai-codex", IMAGE_DESCRIPTION_MODEL);
    return isUsableDescriptionModel(direct) && direct?.id ? direct.id : IMAGE_DESCRIPTION_MODEL;
}
export async function describeImageContentForTextModel(image, ctx, signal) {
    const provider = await resolveCodexToolProvider(ctx);
    const model = resolveImageDescriptionModel(ctx);
    const headers = codexToolProviderHeaders(provider);
    headers.set("accept", "text/event-stream");
    headers.set("OpenAI-Beta", "responses=experimental");
    const response = await fetch(resolveCodexResponsesUrl(provider.baseUrl), {
        method: "POST",
        headers,
        signal: signal ?? null,
        body: JSON.stringify({
            model,
            store: false,
            stream: true,
            instructions: IMAGE_DESCRIPTION_PROMPT,
            text: { verbosity: "low" },
            reasoning: { effort: "low", summary: "auto" },
            input: [{
                    role: "user",
                    content: [
                        { type: "input_text", text: "Describe the image." },
                        { type: "input_image", image_url: `data:${image.mimeType};base64,${image.data}`, detail: image.detail },
                    ],
                }],
        }),
    });
    if (!response.ok)
        throw new Error(`view_image description failed: HTTP ${response.status} ${await response.text()}`);
    let text = "";
    for await (const event of parseSSE(response, signal)) {
        const record = event;
        if (record["type"] === "response.output_text.delta" && typeof record["delta"] === "string")
            text += record["delta"];
        if (record["type"] === "response.output_text.done" && !text.trim() && typeof record["text"] === "string")
            text = record["text"];
        if (record["type"] === "response.completed" && !text.trim())
            text = extractOutputText(record["response"]) ?? "";
    }
    const trimmed = text.trim();
    if (!trimmed)
        throw new Error("view_image description returned no text");
    return trimmed;
}
export function supportsViewImageInputs(model) {
    return Array.isArray(model?.input) && model.input.includes("image");
}
export function createViewImageTool(options = {}) {
    const parameters = createViewImageParameters();
    return {
        name: "view_image",
        label: "view_image",
        description: "View image.",
        ...(options.promptSnippet === false ? {} : { promptSnippet: "View image." }),
        parameters,
        prepareArguments: prepareViewImageArguments,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            if (!supportsViewImageInputs(ctx.model) && !options.describeForTextModels) {
                throw new Error(VIEW_IMAGE_UNSUPPORTED_MESSAGE);
            }
            const typedParams = parseViewImageParams(params);
            if (!supportsViewImageInputs(ctx.model)) {
                const image = await executeRustViewImageContent(typedParams, ctx.cwd, signal);
                const description = await describeImageContentForTextModel(image, ctx, signal);
                return { content: [{ type: "text", text: description }], details: { pathTool: { viewImageDescription: { image, path: typedParams.path, description } } } };
            }
            return executeRustViewImage(typedParams, ctx.cwd, signal);
        },
        ...(options.customRendering === false ? {} : {
            renderCall(args, theme) {
                return renderCodexToolCell("Viewed Image", typeof args["path"] === "string" ? args["path"] : undefined, theme);
            },
            renderResult(result, { isPartial }, theme) {
                if (isPartial) {
                    return new Text(theme.fg("warning", "Loading image..."), 0, 0);
                }
                const textBlock = result.content.find((item) => item.type === "text");
                const text = theme.fg("dim", textBlock?.type === "text" ? textBlock.text : "");
                const content = result.content.some((item) => item.type === "image") ? result.content : [...result.content, ...imageContentsFromPathToolDetails(result.details)];
                return renderTextWithImages(text, content, theme);
            },
        }),
    };
}
export function registerViewImageTool(pi, options = {}) {
    pi.registerTool(createViewImageTool(options));
}
