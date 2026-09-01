import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { IMAGE_MODEL, type ImagegenArgs, MAX_EDIT_IMAGES } from "./contract.js";

const MAX_IMAGE_BYTES = 1024 * 1024 * 1024;

function imageMime(bytes: Uint8Array): string | undefined {
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	)
		return "image/png";
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	)
		return "image/jpeg";
	const prefix = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
	if (prefix === "GIF87a" || prefix === "GIF89a") return "image/gif";
	if (
		bytes.length >= 12 &&
		Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
		Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
	)
		return "image/webp";
	return undefined;
}

async function localImageDataUrl(value: string, cwd: string): Promise<string> {
	const path = isAbsolute(value) ? value : resolve(cwd, value);
	const info = await stat(path);
	if (!info.isFile()) throw new Error("edit image is not a file: " + value);
	if (info.size > MAX_IMAGE_BYTES)
		throw new Error(
			"edit image exceeds " + MAX_IMAGE_BYTES + " bytes: " + value,
		);
	const bytes = await readFile(path);
	const mime = imageMime(bytes);
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
				model: IMAGE_MODEL,
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
			model: IMAGE_MODEL,
			background: "auto",
			quality: "auto",
			size: "auto",
		},
	};
}
