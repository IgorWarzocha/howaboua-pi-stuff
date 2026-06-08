import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
	createReadTool,
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { Text } from "@earendil-works/pi-tui";

const VIEW_IMAGE_UNSUPPORTED_MESSAGE = "view_image is not allowed because you do not support image inputs";
const DETAIL_DESCRIPTION =
	"Use `original` to preserve the file's original resolution; omit for default resized behavior.";

interface ViewImageParams {
	path: string;
	detail?: string | undefined;
}

interface ViewImageReader {
	execute: (toolCallId: string, params: { path: string }, signal?: AbortSignal) => Promise<AgentToolResult<unknown>>;
}

interface ViewImageReaders {
	resized: ViewImageReader;
	original: ViewImageReader;
}

interface CreateViewImageToolOptions {
	allowOriginalDetail?: boolean | undefined;
	createReaders?: (cwd: string) => ViewImageReaders;
}

type ViewImageParameters = ReturnType<typeof createViewImageParameters>;

function createViewImageParameters(allowOriginalDetail: boolean) {
	const properties: Record<string, TSchema> = {
		path: Type.String({ description: "Local image file path." }),
	};
	if (allowOriginalDetail) {
		properties["detail"] = Type.Optional(Type.String({ description: DETAIL_DESCRIPTION }));
	}
	return Type.Object(properties);
}

export function parseViewImageParams(params: unknown): ViewImageParams {
	if (!params || typeof params !== "object" || !("path" in params) || typeof params.path !== "string") {
		throw new Error("view_image requires a string 'path' parameter");
	}
	let detail: string | undefined;
	if ("detail" in params) {
		const rawDetail = params.detail;
		if (rawDetail === null || rawDetail === undefined) {
			detail = undefined;
		} else if (typeof rawDetail !== "string") {
			throw new Error("view_image.detail must be a string when provided");
		} else {
			detail = rawDetail;
		}
	}
	if (detail !== undefined && detail !== "original") {
		throw new Error(
			`view_image.detail only supports \`original\`; omit \`detail\` for default resized behavior, got \`${detail}\``,
		);
	}
	return { path: params.path, detail };
}

function prepareViewImageArguments(args: unknown): Record<string, unknown> {
	if (!args || typeof args !== "object") {
		return args as Record<string, unknown>;
	}

	const record = args as Record<string, unknown>;
	const prepared: Record<string, unknown> = { ...record };
	if (!("path" in prepared)) {
		if ("file_path" in prepared) {
			prepared["path"] = prepared["file_path"]!;
		} else if ("image_path" in prepared) {
			prepared["path"] = prepared["image_path"]!;
		}
	}
	return prepared;
}

function resolveViewImagePath(path: string, cwd: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

async function ensureViewImagePathIsFile(path: string, cwd: string): Promise<string> {
	const absolutePath = resolveViewImagePath(path, cwd);
	let metadata;
	try {
		metadata = await stat(absolutePath);
	} catch (error) {
		throw new Error(`unable to locate image at \`${absolutePath}\`: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!metadata.isFile()) {
		throw new Error(`image path \`${absolutePath}\` is not a file`);
	}
	return absolutePath;
}

function normalizeViewImageResult(result: AgentToolResult<unknown>): AgentToolResult<unknown> {
	const imageContent = result.content.find((item) => item.type === "image");
	if (!imageContent || imageContent.type !== "image") {
		throw new Error("view_image expected an image file. Use exec_command for text files.");
	}
	return {
		...result,
		content: [imageContent],
	};
}

function createDefaultViewImageReaders(cwd: string): ViewImageReaders {
	return {
		resized: createReadTool(cwd),
		original: createReadTool(cwd, { autoResizeImages: false }),
	};
}

function supportsImageInputs(model: ExtensionContext["model"]): boolean {
	return Array.isArray(model?.input) && model.input.includes("image");
}

// Pi exposes image input support on models, but not Codex's finer-grained
// original-detail capability flag. Keep the heuristic narrow to image-capable
// Codex-family models until Pi surfaces an explicit capability.
export function supportsOriginalImageDetail(model: ExtensionContext["model"]): boolean {
	const provider = (model?.provider ?? "").toLowerCase();
	const api = (model?.api ?? "").toLowerCase();
	const id = (model?.id ?? "").toLowerCase();
	return supportsImageInputs(model) && (provider.includes("codex") || api.includes("codex") || id.includes("codex"));
}

export function createViewImageTool(options: CreateViewImageToolOptions = {}): ToolDefinition<ViewImageParameters> {
	const allowOriginalDetail = options.allowOriginalDetail ?? false;
	const parameters = createViewImageParameters(allowOriginalDetail);
	const createReaders = options.createReaders ?? createDefaultViewImageReaders;

	return {
		name: "view_image",
		label: "view_image",
		description: "View a local image file.",
		promptSnippet: "View a local image from the filesystem.",
		parameters,
		prepareArguments: prepareViewImageArguments,
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			if (!supportsImageInputs(ctx.model)) {
				throw new Error(VIEW_IMAGE_UNSUPPORTED_MESSAGE);
			}
			const typedParams = parseViewImageParams(params);
			if (typedParams.detail === "original" && !allowOriginalDetail) {
				throw new Error("view_image.detail is not available for the current model");
			}
			await ensureViewImagePathIsFile(typedParams.path, ctx.cwd);
			const readers = createReaders(ctx.cwd);
			const reader = typedParams.detail === "original" ? readers.original : readers.resized;
			const result = await reader.execute(toolCallId, { path: typedParams.path }, signal);
			return normalizeViewImageResult(result);
		},
		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("view_image"))} ${theme.fg("accent", typeof args["path"]! === "string" ? args["path"]! : "")}`,
				0,
				0,
			);
		},
		renderResult(result, { isPartial, expanded }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Loading image..."), 0, 0);
			}
			const textBlock = result.content.find((item) => item.type === "text");
			let text = theme.fg("success", "Image loaded");
			if (expanded && textBlock?.type === "text") {
				text += `\n${theme.fg("dim", textBlock.text)}`;
			}
			return new Text(text, 0, 0);
		},
	};
}

export function registerViewImageTool(pi: ExtensionAPI, options: CreateViewImageToolOptions = {}): void {
	pi.registerTool(createViewImageTool(options));
}
