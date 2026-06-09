import {
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { getBundledPathToolBinaryPath } from "../path/binary.ts";
import { imageContentFromCodexViewImageOutput } from "../path/outputs.ts";
import { runBundledTool } from "../path/runner.ts";
import { renderCodexToolCell } from "../../ui/tool-rendering/codex-tool-cell.ts";

const VIEW_IMAGE_UNSUPPORTED_MESSAGE = "view_image is not allowed because you do not support image inputs";
interface ViewImageParams {
	path: string;
}

interface CreateViewImageToolOptions {
	customRendering?: boolean | undefined;
	promptSnippet?: boolean | undefined;
}

type ViewImageParameters = ReturnType<typeof createViewImageParameters>;

function createViewImageParameters() {
	const properties: Record<string, TSchema> = { path: Type.String() };
	return Type.Object(properties);
}

export function parseViewImageParams(params: unknown): ViewImageParams {
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
		label: "view_image",
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

export function createViewImageTool(options: CreateViewImageToolOptions = {}): ToolDefinition<ViewImageParameters> {
	const parameters = createViewImageParameters();

	return {
		name: "view_image",
		label: "view_image",
		description: "View image.",
		...(options.promptSnippet === false ? {} : { promptSnippet: "View image." }),
		parameters,
		prepareArguments: prepareViewImageArguments,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!supportsImageInputs(ctx.model)) {
				throw new Error(VIEW_IMAGE_UNSUPPORTED_MESSAGE);
			}
			const typedParams = parseViewImageParams(params);
			return executeRustViewImage(typedParams, ctx.cwd, signal);
		},
		...(options.customRendering === false ? {} : {
		renderCall(args, theme) {
			return renderCodexToolCell("Viewed Image", typeof args["path"]! === "string" ? args["path"]! : undefined, theme);
		},
		renderResult(result, { isPartial, expanded }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Loading image..."), 0, 0);
			}
			if (!expanded) {
				return new Text("", 0, 0);
			}
			const textBlock = result.content.find((item) => item.type === "text");
			return new Text(theme.fg("dim", textBlock?.type === "text" ? textBlock.text : ""), 0, 0);
		},
		}),
	};
}

export function registerViewImageTool(pi: ExtensionAPI, options: CreateViewImageToolOptions = {}): void {
	pi.registerTool(createViewImageTool(options));
}
