import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { saveGeneratedImages } from "./artifacts.js";
import type { CodexToolRouteConfig } from "./codex-runtime/config.js";
import {
	IMAGE_MODEL,
	type ImageGenerationToolOptions,
	type ImagegenArgs,
	type ImageResponse,
} from "./contract.js";
import { recentConversationImageUrls } from "./history.js";
import type { ImagegenOutput } from "./output.js";
import { buildImageGenerationRequest } from "./request.js";

function parseImageResponse(text: string): ImageResponse {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("failed to decode image generation response");
	}
	if (
		!parsed ||
		typeof parsed !== "object" ||
		!("data" in parsed) ||
		!Array.isArray(parsed.data) ||
		!parsed.data.every(
			(item) =>
				item &&
				typeof item === "object" &&
				"b64_json" in item &&
				typeof item.b64_json === "string" &&
				item.b64_json.length > 0,
		)
	)
		throw new Error("image generation returned no image data");
	return parsed as ImageResponse;
}

async function resolveProvider(
	ctx: ExtensionContext,
	options: ImageGenerationToolOptions,
	config: CodexToolRouteConfig,
) {
	const { isCodexToolRoute } = await import("./codex-runtime/config.js");
	const isConfiguredCodexTransport = (model: ExtensionContext["model"]) =>
		isCodexToolRoute(config, model);
	if (isConfiguredCodexTransport(ctx.model)) {
		const { resolveCodexToolProvider } = await import(
			"./codex-runtime/resolve.js"
		);
		return resolveCodexToolProvider(
			ctx,
			options.allowConfiguredProvider,
			isConfiguredCodexTransport,
		);
	}
	const hosted = await options.resolveProvider?.(ctx);
	if (hosted) return hosted;
	const { resolveCodexToolProvider } = await import(
		"./codex-runtime/resolve.js"
	);
	return resolveCodexToolProvider(
		ctx,
		options.allowConfiguredProvider,
		isConfiguredCodexTransport,
	);
}

export async function executeCodexImageGeneration(
	args: ImagegenArgs,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	options: ImageGenerationToolOptions = {},
	turnId?: string,
): Promise<ImagegenOutput> {
	if (signal?.aborted) throw new Error("imagegen aborted");
	const { readCodexToolRouteConfig, resolveCodexToolModel } = await import(
		"./codex-runtime/config.js"
	);
	const routeConfig = readCodexToolRouteConfig();
	const recentImages =
		args.num_last_images_to_include === undefined
			? undefined
			: recentConversationImageUrls(
					ctx.sessionManager.buildContextEntries(),
					args.num_last_images_to_include,
				);
	if (
		args.num_last_images_to_include !== undefined &&
		recentImages?.length !== args.num_last_images_to_include
	)
		throw new Error(
			"requested the last " +
				args.num_last_images_to_include +
				" conversation images, but only " +
				(recentImages?.length ?? 0) +
				" were available",
		);
	const request = await buildImageGenerationRequest(
		args,
		recentImages,
		ctx.cwd,
		resolveCodexToolModel(routeConfig, ctx.model, IMAGE_MODEL),
	);
	const provider = await resolveProvider(ctx, options, routeConfig);
	const [{ codexToolProviderHeaders }, { fetchCodexTool }] = await Promise.all([
		import("./codex-runtime/headers.js"),
		import("./codex-runtime/http.js"),
	]);
	const endpoint =
		provider.baseUrl.replace(/\/+$/, "") + "/images/" + request.operation;
	const headers = codexToolProviderHeaders(provider);
	headers.set("accept", "application/json");
	if (turnId) headers.set("x-codex-image-turn-id", turnId);
	const response = await fetchCodexTool(endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify(request.body),
		...(signal ? { signal } : {}),
	});
	if (response.status < 200 || response.status >= 300)
		throw new Error(
			"image generation failed: HTTP " + response.status + " " + response.text,
		);
	return saveGeneratedImages(
		ctx.cwd,
		parseImageResponse(response.text),
		response.headers.get("x-codex-imagegen-request-id") ?? undefined,
	);
}
