import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ImageResponse } from "./contract.js";
import type { ImagegenOutput } from "./output.js";

const IMAGE_DIRECTORY = ".pi/openai-codex-images";
const LATEST_IMAGE_NAME = "latest.png";

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

function decodeBase64Image(value: string): Buffer {
	const normalized = value.trim();
	if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized))
		throw new Error("image generation returned invalid base64 data");
	const bytes = Buffer.from(normalized, "base64");
	if (bytes.length === 0)
		throw new Error("image generation returned empty image data");
	return bytes;
}

export async function saveGeneratedImages(
	cwd: string,
	response: ImageResponse,
	requestId: string | undefined,
): Promise<ImagegenOutput> {
	const root = await workspaceRoot(cwd);
	const outputDirectory = join(root, IMAGE_DIRECTORY);
	await mkdir(outputDirectory, { recursive: true });
	const latest = join(outputDirectory, LATEST_IMAGE_NAME);
	const images = [];
	for (const [index, item] of response.data.entries()) {
		const bytes = decodeBase64Image(item.b64_json);
		const suffix = randomUUID().replaceAll("-", "");
		const name =
			index === 0
				? "ig_" + suffix + ".png"
				: "ig_" + suffix + "_" + (index + 1) + ".png";
		const path = join(outputDirectory, name);
		await writeFile(path, bytes);
		if (index === 0) await writeFile(latest, bytes);
		images.push({
			path: relative(root, path),
			absolute_path: path,
			latest_path: relative(root, latest),
			latest_absolute_path: latest,
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
		path: first.path,
		latest_path: first.latest_path,
		images,
		background: response.background,
		transparent_background: transparentBackground,
		quality: response.quality,
		size: response.size,
		imagegen_request_id: requestId,
	};
}
