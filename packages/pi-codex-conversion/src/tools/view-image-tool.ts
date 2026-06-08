import {
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { getBundledPathToolBinaryPath } from "./path-tools-binary.ts";
import { imageContentFromCodexViewImageOutput } from "./path-tool-outputs.ts";
import { runBundledTool } from "./path-tool-runner.ts";

const VIEW_IMAGE_UNSUPPORTED_MESSAGE = "view_image is not allowed because you do not support image inputs";
const DETAIL_DESCRIPTION =
	"Use `original` to preserve the file's original resolution; omit for default resized behavior.";

interface ViewImageParams {
	path: string;
	detail?: string | undefined;
}

interface CreateViewImageToolOptions {
	allowOriginalDetail?: boolean | undefined;
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

async function executeRustViewImage(params: ViewImageParams, cwd: string, signal: AbortSignal | undefined): Promise<AgentToolResult<unknown>> {
	const binary = getBundledPathToolBinaryPath("view_image");
	if (!binary) {
		throw new Error(`view_image binary is not bundled for ${process.platform}-${process.arch}`);
	}
	const child = await runBundledTool({
		binary,
		args: [JSON.stringify(params)],
		cwd,
		signal,
	});
	if (child.status !== 0) {
		throw new Error((child.stderr || child.stdout || "view_image failed").trim());
	}
	const imageContent = imageContentFromCodexViewImageOutput(child.stdout);
	if (!imageContent) {
		throw new Error("view_image expected an image file. Use exec_command for text files.");
	}
	return { content: [imageContent], details: { pathTool: { viewImage: true } } };
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

	return {
		name: "view_image",
		label: "view_image",
		description: "View a local image file.",
		promptSnippet: "View a local image from the filesystem.",
		parameters,
		prepareArguments: prepareViewImageArguments,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!supportsImageInputs(ctx.model)) {
				throw new Error(VIEW_IMAGE_UNSUPPORTED_MESSAGE);
			}
			const typedParams = parseViewImageParams(params);
			if (typedParams.detail === "original" && !allowOriginalDetail) {
				throw new Error("view_image.detail is not available for the current model");
			}
			return executeRustViewImage(typedParams, ctx.cwd, signal);
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
