import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Container, Image, Spacer, Text } from "@earendil-works/pi-tui";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { extractAccountId, resolveCodexUrl } from "../providers/openai-codex/headers.ts";
import { IMAGE_GENERATION_TOOL_NAME } from "../adapter/tool-set.ts";

export const IMAGE_GENERATION_UNSUPPORTED_MESSAGE = "imagegen requires an image-capable OpenAI Codex-compatible Responses provider";
const IMAGE_DIR = ".pi/openai-codex-images";
const LATEST_IMAGE_NAME = "latest.png";

const IMAGE_GENERATION_PARAMETERS = Type.Object({
	prompt: Type.String({ description: "Image generation or edit prompt." }),
	action: Type.Optional(Type.Union([Type.Literal("generate"), Type.Literal("edit")], { description: "Defaults to generate." })),
	images: Type.Optional(Type.Array(Type.String(), { description: "For edits: image paths, data URLs, or HTTPS URLs." })),
	background: Type.Optional(Type.Union([Type.Literal("transparent"), Type.Literal("opaque"), Type.Literal("auto")])),
	quality: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("auto")])),
	size: Type.Optional(Type.String()),
});

type ImagegenArgs = {
	prompt: string;
	action?: "generate" | "edit" | undefined;
	images?: string[] | undefined;
	background?: "transparent" | "opaque" | "auto" | undefined;
	quality?: "low" | "medium" | "high" | "auto" | undefined;
	size?: string | undefined;
};

type SavedImage = { path: string; absolute_path: string; latest_path: string; latest_absolute_path: string };

type ImagegenDetails = { path: string; latest_path: string; images: SavedImage[]; background?: string | undefined; quality?: string | undefined; size?: string | undefined };

function supportsImageInputs(model: ExtensionContext["model"]): boolean {
	return !Array.isArray(model?.input) || model.input.includes("image");
}

export function supportsNativeImageGeneration(model: ExtensionContext["model"]): boolean {
	return (model?.provider ?? "").toLowerCase() === "openai-codex" && Boolean(model?.api?.includes("responses")) && supportsImageInputs(model);
}

function supportsExecutableImageGeneration(model: ExtensionContext["model"]): boolean {
	return supportsNativeImageGeneration(model) || ((model?.provider ?? "").toLowerCase() !== "openai" && Boolean(model?.api?.includes("responses")) && supportsImageInputs(model));
}

function createEmptyResultComponent(): Container { return new Container(); }

async function resolveAuth(ctx: ExtensionContext): Promise<Headers> {
	if (!ctx.model) throw new Error(IMAGE_GENERATION_UNSUPPORTED_MESSAGE);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error(auth.error);
	const apiKey = auth.apiKey ?? auth.headers?.["Authorization"]?.replace(/^Bearer\s+/i, "");
	if (!apiKey) throw new Error(IMAGE_GENERATION_UNSUPPORTED_MESSAGE);
	const headers = new Headers();
	for (const [key, value] of Object.entries(auth.headers ?? {})) headers.set(key, value);
	headers.set("Authorization", `Bearer ${apiKey}`);
	if (!headers.has("chatgpt-account-id")) headers.set("chatgpt-account-id", extractAccountId(apiKey));
	headers.set("originator", "pi");
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("content-type", "application/json");
	headers.set("accept", "text/event-stream");
	return headers;
}
function workspaceRoot(cwd: string): string {
	let current = resolve(cwd);
	for (;;) {
		try { readFileSync(join(current, ".git")); return current; } catch {}
		try { if (readFileSync(join(current, ".git", "HEAD"))) return current; } catch {}
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}

function imageUrlFromArg(value: string): string {
	if (value.startsWith("data:image/") || value.startsWith("http://") || value.startsWith("https://")) return value;
	const bytes = readFileSync(value);
	const ext = value.toLowerCase().split(".").pop();
	const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
	return `data:${mime};base64,${bytes.toString("base64")}`;
}

function buildInput(args: ImagegenArgs): unknown[] {
	if (args.action !== "edit") return [{ type: "message", role: "user", content: [{ type: "input_text", text: args.prompt }] }];
	if (!args.images?.length) throw new Error("image edit requires an images array of paths or image URLs");
	return [{ type: "message", role: "user", content: [{ type: "input_text", text: args.prompt }, ...args.images.map((image) => ({ type: "input_image", image_url: imageUrlFromArg(image), detail: "auto" }))] }];
}

function buildRequest(args: ImagegenArgs, ctx: ExtensionContext): Record<string, unknown> {
	const tool: Record<string, unknown> = { type: "image_generation", output_format: "png" };
	if (args.background) tool["background"] = args.background;
	if (args.quality) tool["quality"] = args.quality;
	if (args.size) tool["size"] = args.size;
	return {
		model: ctx.model?.id ?? "gpt-5.4-mini",
		instructions: "Use image_generation to satisfy the request. Do not answer with text only.",
		text: { verbosity: "low" },
		input: buildInput(args),
		tools: [tool],
		tool_choice: "required",
		parallel_tool_calls: true,
		store: false,
		stream: true,
	};
}

function parseSseText(text: string): unknown[] {
	return text.replace(/\r\n?/g, "\n").split("\n\n").flatMap((frame) => {
		const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
		if (!data || data === "[DONE]") return [];
		try { return [JSON.parse(data)]; } catch { return []; }
	});
}

function collectImages(events: unknown[]): { data: string[]; background?: string | undefined; quality?: string | undefined; size?: string | undefined } {
	const data: string[] = [];
	let background: string | undefined;
	let quality: string | undefined;
	let size: string | undefined;
	for (const event of events) {
		if (!event || typeof event !== "object") continue;
		const item = event as any;
		if (item.type === "response.failed") throw new Error(item.response?.error?.message ?? item.error?.message ?? "imagegen responses failed");
		if (item.type !== "response.output_item.done" || item.item?.type !== "image_generation_call") continue;
		if (typeof item.item.result === "string" && item.item.result) data.push(item.item.result);
		if (typeof item.item.background === "string") background = item.item.background;
		if (typeof item.item.quality === "string") quality = item.item.quality;
		if (typeof item.item.size === "string") size = item.item.size;
	}
	if (!data.length) throw new Error("image generation returned no image data");
	return { data, background, quality, size };
}

function saveImages(cwd: string, response: ReturnType<typeof collectImages>): ImagegenDetails {
	const root = workspaceRoot(cwd);
	const outDir = join(root, IMAGE_DIR);
	mkdirSync(outDir, { recursive: true });
	const latest = join(outDir, LATEST_IMAGE_NAME);
	const images: SavedImage[] = response.data.map((b64, index) => {
		const path = join(outDir, `ig_${randomUUID().replaceAll("-", "")}${index === 0 ? "" : `_${index + 1}`}.png`);
		const bytes = Buffer.from(b64, "base64");
		writeFileSync(path, bytes);
		if (index === 0) writeFileSync(latest, bytes);
		return { path: relative(root, path), absolute_path: path, latest_path: relative(root, latest), latest_absolute_path: latest };
	});
	return { path: images[0]!.path, latest_path: images[0]!.latest_path, images, background: response.background, quality: response.quality, size: response.size };
}

function formatImagegenOutput(output: ImagegenDetails): string {
	const lines = [`Generated image: ${output.path}`, `Latest: ${output.latest_path}`];
	const metadata = [output.size, output.quality, output.background].filter((item): item is string => typeof item === "string" && item.length > 0);
	if (metadata.length) lines.push(`Info: ${metadata.join(", ")}`);
	return lines.join("\n");
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

export function createImageGenerationTool(): ToolDefinition<typeof IMAGE_GENERATION_PARAMETERS, ImagegenDetails> {
	const description = "Generate an image. Outputs are saved under `.pi/openai-codex-images/` and mirrored to `.pi/openai-codex-images/latest.png`.";
	return {
		name: IMAGE_GENERATION_TOOL_NAME,
		label: IMAGE_GENERATION_TOOL_NAME,
		description,
		promptSnippet: description,
		parameters: IMAGE_GENERATION_PARAMETERS,
		prepareArguments: (args) => args as any,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!supportsExecutableImageGeneration(ctx.model)) throw new Error(IMAGE_GENERATION_UNSUPPORTED_MESSAGE);
			const response = await fetch(resolveCodexUrl(ctx.model?.baseUrl), { method: "POST", headers: await resolveAuth(ctx), signal: signal ?? null, body: JSON.stringify(buildRequest(params, ctx)) });
			const body = await response.text();
			if (!response.ok) throw new Error(`imagegen failed: HTTP ${response.status} ${body}`);
			const details = saveImages(ctx.cwd, collectImages(parseSseText(body)));
			return { content: [{ type: "text", text: formatImagegenOutput(details) }, ...details.images.map((image) => ({ type: "image" as const, mimeType: "image/png", data: readFileSync(image.absolute_path).toString("base64"), detail: "high" as const }))], details };
		},
		renderCall(_args, theme) { return new Text(`${theme.fg("toolTitle", theme.bold(IMAGE_GENERATION_TOOL_NAME))}`, 0, 0); },
		renderResult(result, { expanded }, theme) {
			if (!expanded) return createEmptyResultComponent();
			const textBlock = result.content.find((item) => item.type === "text");
			const text = theme.fg("dim", textBlock?.type === "text" ? textBlock.text : "(no output)");
			return result.details ? renderResultWithImages(text, result.details, theme) : new Text(text, 0, 0);
		},
	};
}

export function registerImageGenerationTool(pi: ExtensionAPI): void { pi.registerTool(createImageGenerationTool()); }
