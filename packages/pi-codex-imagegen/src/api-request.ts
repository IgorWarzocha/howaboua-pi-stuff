import type { ImagegenArgs, OutputFormat } from "./contract.js";
import { buildImageGenerationRequest } from "./request.js";
import type { ImagegenSettings } from "./settings.js";

function validateImageSize(size: string, format: OutputFormat): void {
	if (size === "auto") return;
	if (!/^[1-9][0-9]*x[1-9][0-9]*$/.test(size))
		throw new Error("Image size must be auto or WIDTHxHEIGHT.");
	const [width, height] = size.split("x").map(Number);
	if (
		!width ||
		!height ||
		width % 16 ||
		height % 16 ||
		Math.max(width, height) > 3840 ||
		Math.max(width / height, height / width) > 3
	)
		throw new Error(
			"Image dimensions must be multiples of 16, at most 3840 per edge, with an aspect ratio between 1:3 and 3:1.",
		);
	if (format !== "gif" && (width * height < 655360 || width * height > 8294400))
		throw new Error(
			"Still image size must contain 655360 to 8294400 pixels. Use auto or a larger size.",
		);
}

export async function buildOpenAIImageRequest(
	args: ImagegenArgs,
	recentImages: string[] | undefined,
	cwd: string,
	settings: ImagegenSettings["api"],
) {
	const format = args.output_format ?? (args.gif ? "gif" : "png");
	if (args.gif && format !== "gif")
		throw new Error("gif controls require GIF output_format.");
	const background = args.transparent_background ? "transparent" : "opaque";
	if (background === "transparent" && !["png", "webp"].includes(format))
		throw new Error(
			"Transparent output requires PNG or WebP. Choose a compatible output_format or an opaque background.",
		);
	validateImageSize(args.size ?? "auto", format);
	const editing = Boolean(
		args.referenced_image_paths?.length ||
			args.num_last_images_to_include != null,
	);
	if (editing && ["gif", "svg"].includes(format))
		throw new Error(
			"OpenAI API " +
				format.toUpperCase() +
				" output supports generation only. Use PNG, JPEG or WebP for edits.",
		);
	const request = await buildImageGenerationRequest(
		args,
		recentImages,
		cwd,
		settings.model,
	);
	if (request.operation === "edits") {
		for (const item of request.body.images) {
			if (!/^data:image\/(png|jpeg|webp);base64,/.test(item.image_url))
				throw new Error(
					"OpenAI API edit inputs must be PNG, JPEG or WebP. Convert GIF inputs before editing.",
				);
			if (
				Buffer.byteLength(item.image_url.split(",")[1] ?? "", "base64") >=
				50 * 1024 * 1024
			)
				throw new Error("OpenAI API edit inputs must be smaller than 50 MB.");
		}
	}
	Object.assign(request.body, {
		background,
		quality: settings.quality,
		complexity: settings.complexity,
		size: args.size ?? "auto",
		n: 1,
		output_format: format,
	});
	if (format === "gif") Object.assign(request.body, args.gif);
	return { ...request, format };
}
