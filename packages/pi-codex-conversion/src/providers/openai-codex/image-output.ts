import { OPENAI_CODEX_IMAGE_DIR, OPENAI_CODEX_LATEST_IMAGE_NAME } from "./constants.ts";
import { dirnamePath, joinPaths, normalizePath, relativePath } from "./path-utils.ts";
import { getNodeFsPromises } from "./node-runtime.ts";
import type { SavedGeneratedImage } from "./types.ts";

const workspaceRootCache = new Map<string, Promise<string>>();

function sanitizeFilePart(value: string | undefined, fallback: string): string {
	const trimmed = (value ?? "").trim();
	if (!trimmed) return fallback;
	return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function shortenFilePart(value: string | undefined, fallback: string): string {
	const safe = sanitizeFilePart(value, fallback);
	const match = /^([a-zA-Z]+_)(.+)$/.exec(safe);
	const prefix = match?.[1] ?? "";
	const body = match?.[2] ?? safe;
	if (body.length <= 12) return `${prefix}${body}`;
	return `${prefix}${body.slice(0, 8)}-${body.slice(-4)}`;
}

export function normalizeImageOutputFormat(value: string | undefined): string {
	const format = (value ?? "png").toLowerCase();
	return format === "png" || format === "jpg" || format === "jpeg" || format === "webp" ? format : "png";
}

async function pathExists(value: string): Promise<boolean> {
	try {
		const fs = await getNodeFsPromises();
		await fs.access(value);
		return true;
	} catch {
		return false;
	}
}

async function resolveWorkspaceRoot(cwd: string): Promise<string> {
	const normalizedCwd = normalizePath(cwd);
	const cached = workspaceRootCache.get(normalizedCwd);
	if (cached) return cached;

	const promise = (async () => {
		let current = normalizedCwd;
		while (true) {
			if (await pathExists(joinPaths(current, ".git"))) {
				return current;
			}
			const parent = dirnamePath(current);
			if (parent === current || parent === ".") {
				return normalizedCwd;
			}
			current = parent;
		}
	})();

	workspaceRootCache.set(normalizedCwd, promise);
	return promise;
}

export function getOpenAICodexImageDirectory(cwd: string): string {
	return joinPaths(cwd, OPENAI_CODEX_IMAGE_DIR);
}

export function getOpenAICodexImagePath(cwd: string, responseId: string | undefined, callId: string, outputFormat?: string): string {
	const ext = normalizeImageOutputFormat(outputFormat);
	const safeCallId = shortenFilePart(callId, "image");
	const safeResponseId = shortenFilePart(responseId, "response");
	return joinPaths(getOpenAICodexImageDirectory(cwd), `${safeCallId}-${safeResponseId}.${ext}`);
}

export function getOpenAICodexLatestImagePath(cwd: string): string {
	return joinPaths(getOpenAICodexImageDirectory(cwd), OPENAI_CODEX_LATEST_IMAGE_NAME);
}

export function buildGeneratedImageDisplayText(savedImage: SavedGeneratedImage, options?: { expanded?: boolean | undefined }): string {
	const lines: string[] = [];
	if (options?.expanded && savedImage.revisedPrompt) {
		lines.push(`Prompt: ${savedImage.revisedPrompt}`);
	}
	lines.push(`File: ${savedImage.relativePath}`);
	return lines.join("\n");
}

export async function saveOpenAICodexGeneratedImage(
	cwd: string,
	image: { responseId?: string | undefined; callId: string; result: string; outputFormat?: string | undefined; revisedPrompt?: string | undefined },
): Promise<SavedGeneratedImage> {
	const workspaceRoot = await resolveWorkspaceRoot(cwd);
	const fs = await getNodeFsPromises();
	const bytes = Buffer.from(image.result, "base64");
	const outputFormat = normalizeImageOutputFormat(image.outputFormat);
	const absolutePath = getOpenAICodexImagePath(workspaceRoot, image.responseId, image.callId, outputFormat);
	const latestAbsolutePath = getOpenAICodexLatestImagePath(workspaceRoot);
	await fs.mkdir(dirnamePath(absolutePath), { recursive: true });
	await fs.writeFile(absolutePath, bytes);
	await fs.writeFile(latestAbsolutePath, bytes);

	const relativeFilePath = relativePath(workspaceRoot, absolutePath);
	const latestRelativeFilePath = relativePath(workspaceRoot, latestAbsolutePath);
	const relativePathValue = relativeFilePath && !relativeFilePath.startsWith("..") ? relativeFilePath : absolutePath;
	const latestRelativePathValue =
		latestRelativeFilePath && !latestRelativeFilePath.startsWith("..") ? latestRelativeFilePath : latestAbsolutePath;

	return {
		absolutePath,
		relativePath: relativePathValue,
		latestAbsolutePath,
		latestRelativePath: latestRelativePathValue,
		responseId: image.responseId,
		callId: image.callId,
		outputFormat,
		revisedPrompt: image.revisedPrompt,
	};
}
