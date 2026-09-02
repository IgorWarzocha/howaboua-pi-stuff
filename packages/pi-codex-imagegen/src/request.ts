import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { IMAGE_MODEL, type ImagegenArgs, MAX_EDIT_IMAGES } from "./contract.js";
import { validatedImageMime } from "./image-validation.js";

const MAX_IMAGE_BYTES = 1024 * 1024 * 1024;

async function localImageDataUrl(value: string, cwd: string): Promise<string> {
	const path = isAbsolute(value) ? value : resolve(cwd, value);
	const info = await stat(path);
	if (!info.isFile()) throw new Error("edit image is not a file: " + value);
	if (info.size > MAX_IMAGE_BYTES)
		throw new Error(
			"edit image exceeds " + MAX_IMAGE_BYTES + " bytes: " + value,
		);
	const bytes = await readFile(path);
	const mime = validatedImageMime(bytes);
	if (!mime)
		throw new Error("edit image must be PNG, JPEG, GIF, or WebP: " + value);
	return "data:" + mime + ";base64," + bytes.toString("base64");
}

function recentImageDataUrl(value: string): string {
	const separator = value.indexOf(",");
	const metadata = separator >= 0 ? value.slice(0, separator) : "";
	const data = separator >= 0 ? value.slice(separator + 1) : "";
	if (
		!metadata.startsWith("data:image/") ||
		!metadata.endsWith(";base64") ||
		!data
	)
		throw new Error("recent conversation image is not a base64 image data URL");
	return value;
}

export async function buildImageGenerationRequest(
	args: ImagegenArgs,
	recentImages: string[] | undefined,
	cwd: string,
	model: string = IMAGE_MODEL,
): Promise<{
	operation: "generations" | "edits";
	body: Record<string, unknown>;
}> {
	const paths = args.referenced_image_paths ?? [];
	if (paths.length > MAX_EDIT_IMAGES)
		throw new Error(
			"referenced_image_paths must contain at most " +
				MAX_EDIT_IMAGES +
				" paths",
		);
	if (paths.length > 0 && args.num_last_images_to_include !== undefined)
		throw new Error(
			"provide only one of referenced_image_paths or num_last_images_to_include",
		);
	if (paths.length === 0 && args.num_last_images_to_include === undefined) {
		return {
			operation: "generations",
			body: {
				prompt: args.prompt,
				model,
				background: "auto",
				quality: "auto",
				size: "auto",
			},
		};
	}
	const images =
		paths.length > 0
			? await Promise.all(
					paths.map(async (path) => ({
						image_url: await localImageDataUrl(path, cwd),
					})),
				)
			: (recentImages ?? []).map((image) => ({
					image_url: recentImageDataUrl(image),
				}));
	return {
		operation: "edits",
		body: {
			images,
			prompt: args.prompt,
			model,
			background: "auto",
			quality: "auto",
			size: "auto",
		},
	};
}
