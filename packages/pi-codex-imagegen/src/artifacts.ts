import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { convertToPng } from "@earendil-works/pi-coding-agent";
import type { ImageResponse, OutputFormat } from "./contract.js";
import { validatedImageMime } from "./image-validation.js";
import type { ImageContent, ImagegenOutput } from "./output.js";

const IMAGE_DIRECTORY = ".pi/openai-codex-images";
const BASE64_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const FORMAT_MIME: Record<OutputFormat, string> = {
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
};

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return false;
		throw error;
	}
}

async function workspaceRoot(cwd: string): Promise<string> {
	let current = resolve(cwd);
	while (true) {
		if (await pathExists(join(current, ".git"))) return current;
		const parent = resolve(current, "..");
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}

function decodeBase64Image(value: string) {
	const data = value.trim();
	if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
		throw new Error("image generation returned invalid base64 data");
	const bytes = Buffer.from(data, "base64");
	if (bytes.length === 0)
		throw new Error("image generation returned empty image data");
	return { data, bytes };
}

function canonicalBase64(data: string, bytes: Buffer): string {
	// The prior file encoding zeroed unused pad bits even for noncanonical input.
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	if (!padding) return data;
	const lastSextet = BASE64_ALPHABET.indexOf(
		data.charAt(data.length - padding - 1),
	);
	return lastSextet % (1 << (2 * padding)) === 0
		? data
		: bytes.toString("base64");
}

export async function saveGeneratedImages(
	cwd: string,
	response: ImageResponse,
	requestId: string | undefined,
	format: OutputFormat,
	includeImageContent: boolean,
): Promise<{ details: ImagegenOutput; imageContent: ImageContent[] }> {
	const mime = FORMAT_MIME[format];
	const decoded = response.data.map((item) => {
		const image = decodeBase64Image(item.b64_json);
		const { bytes } = image;
		const actual =
			validatedImageMime(bytes) ??
			(/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/.test(
				bytes.toString("utf8"),
			)
				? "image/svg+xml"
				: undefined);
		if (actual !== mime)
			throw new Error(
				"Image generation returned an unexpected format instead of " +
					format.toUpperCase() +
					". No output was saved.",
			);
		return image;
	});
	if (decoded.length === 0)
		throw new Error("image generation returned no image data");
	const root = await workspaceRoot(cwd);
	const outputDirectory = join(root, IMAGE_DIRECTORY);
	await mkdir(outputDirectory, { recursive: true });
	const latest = join(outputDirectory, "latest." + format);
	const images = [];
	const imageContent: ImageContent[] = [];
	for (const [index, { data, bytes }] of decoded.entries()) {
		const suffix = randomUUID().replaceAll("-", "");
		const name =
			index === 0
				? "ig_" + suffix + "." + format
				: "ig_" + suffix + "_" + (index + 1) + "." + format;
		const path = join(outputDirectory, name);
		await writeFile(path, bytes);
		if (index === 0) await writeFile(latest, bytes);
		let previewPath: string | undefined;
		if (format === "gif") {
			const preview = await convertToPng(data, mime);
			if (preview) {
				previewPath = join(outputDirectory, "ig_" + suffix + ".preview.png");
				await writeFile(previewPath, Buffer.from(preview.data, "base64"));
				if (includeImageContent)
					imageContent.push({
						type: "image",
						data: preview.data,
						mimeType: preview.mimeType,
						detail: "high",
					});
			}
		} else if (includeImageContent && format !== "svg")
			imageContent.push({
				type: "image",
				data: canonicalBase64(data, bytes),
				mimeType: mime,
				detail: "high",
			});
		images.push({
			path: relative(root, path),
			absolute_path: path,
			latest_path: relative(root, latest),
			latest_absolute_path: latest,
			mime_type: mime,
			...(previewPath ? { preview_absolute_path: previewPath } : {}),
		});
	}
	const first = images[0];
	if (!first) throw new Error("image generation returned no image data");
	const transparentBackground =
		response.background === "transparent"
			? true
			: response.background === "opaque"
				? false
				: undefined;
	return {
		details: {
			path: first.path,
			latest_path: first.latest_path,
			images,
			output_format: format,
			background: response.background,
			transparent_background: transparentBackground,
			quality: response.quality,
			size: response.size,
			imagegen_request_id: requestId,
		},
		imageContent,
	};
}
