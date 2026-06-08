import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createViewImageTool, parseViewImageParams } from "../src/tools/view-image-tool.ts";

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

function createReader(label: string, calls: string[]) {
	return {
		async execute() {
			calls.push(label);
			return {
				content: [
					{ type: "text" as const, text: `${label} note` },
					{ type: "image" as const, data: PNG_BASE64, mimeType: "image/png" },
				],
				details: { label },
			};
		},
	};
}

test("parseViewImageParams accepts omitted and null detail, but rejects invalid detail values", () => {
	assert.deepEqual(parseViewImageParams({ path: "assets/example.png" }), { path: "assets/example.png", detail: undefined });
	assert.deepEqual(parseViewImageParams({ path: "assets/example.png", detail: null }), {
		path: "assets/example.png",
		detail: undefined,
	});
	assert.throws(
		() => parseViewImageParams({ path: "assets/example.png", detail: "low" }),
		/view_image\.detail only supports `original`; omit `detail` for default resized behavior, got `low`/,
	);
	assert.throws(() => parseViewImageParams({ path: "assets/example.png", detail: 1 }), /view_image\.detail must be a string/);
});

test("createViewImageTool prepareArguments normalizes alternate path field names", () => {
	const tool = createViewImageTool({ allowOriginalDetail: true });

	assert.deepEqual(tool.prepareArguments?.({ file_path: "image.png", detail: "original" }), {
		file_path: "image.png",
		path: "image.png",
		detail: "original",
	});
});

test("createViewImageTool prepareArguments preserves invalid detail values for validation", () => {
	const tool = createViewImageTool({ allowOriginalDetail: true });

	assert.deepEqual(tool.prepareArguments?.({ file_path: "image.png", detail: 1 }), {
		file_path: "image.png",
		path: "image.png",
		detail: 1,
	});
	assert.throws(() => parseViewImageParams(tool.prepareArguments?.({ file_path: "image.png", detail: 1 })), /view_image\.detail must be a string/);
});

test("createViewImageTool uses resized reader by default and strips text output", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	const imagePath = join(cwd, "image.png");
	await writeFile(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const calls: string[] = [];
	const tool = createViewImageTool({
		allowOriginalDetail: true,
		createReaders() {
			return {
				resized: createReader("resized", calls),
				original: createReader("original", calls),
			};
		},
	});

	const result = await tool.execute("call-1", { path: "image.png" }, undefined, undefined, {
		cwd,
		model: { input: ["image"] },
	} as never);

	assert.deepEqual(calls, ["resized"]);
	assert.equal(result.content.length, 1);
	assert.deepEqual(result.content[0]!, { type: "image", data: PNG_BASE64, mimeType: "image/png" });
});

test("createViewImageTool uses original reader when requested", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	const imagePath = join(cwd, "image.png");
	await writeFile(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const calls: string[] = [];
	const tool = createViewImageTool({
		allowOriginalDetail: true,
		createReaders() {
			return {
				resized: createReader("resized", calls),
				original: createReader("original", calls),
			};
		},
	});

	const result = await tool.execute("call-2", { path: "image.png", detail: "original" }, undefined, undefined, {
		cwd,
		model: { input: ["image"] },
	} as never);

	assert.deepEqual(calls, ["original"]);
	assert.equal(result.content.length, 1);
	assert.equal(result.content[0]!?.type, "image");
});

test("createViewImageTool rejects missing paths and directories with codex-like errors", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	const dirPath = join(cwd, "screenshots");
	await mkdir(dirPath);

	const tool = createViewImageTool({
		allowOriginalDetail: true,
		createReaders() {
			return {
				resized: createReader("resized", []),
				original: createReader("original", []),
			};
		},
	});

	await assert.rejects(
		() => tool.execute("call-3", { path: "missing.png" }, undefined, undefined, { cwd, model: { input: ["image"] } } as never),
		new RegExp(`unable to locate image at \`${join(cwd, "missing.png").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``),
	);
	await assert.rejects(
		() => tool.execute("call-4", { path: "screenshots" }, undefined, undefined, { cwd, model: { input: ["image"] } } as never),
		new RegExp(`image path \`${dirPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\` is not a file`),
	);
});

test("createViewImageTool rejects non-image read results", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	const imagePath = join(cwd, "image.png");
	await writeFile(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const tool = createViewImageTool({
		allowOriginalDetail: true,
		createReaders() {
			return {
				resized: {
					async execute() {
						return {
							content: [{ type: "text" as const, text: "plain text" }],
							details: {},
						};
					},
				},
				original: createReader("original", []),
			};
		},
	});

	await assert.rejects(
		() => tool.execute("call-5", { path: "image.png" }, undefined, undefined, { cwd, model: { input: ["image"] } } as never),
		/view_image expected an image file\. Use exec_command for text files\./,
	);
});

test("createViewImageTool resolves relative paths against execute context cwd", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	const imagePath = join(cwd, "image.png");
	await writeFile(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const seenCwds: string[] = [];
	const tool = createViewImageTool({
		createReaders(currentCwd) {
			seenCwds.push(currentCwd);
			return {
				resized: createReader("resized", []),
				original: createReader("original", []),
			};
		},
	});

	await tool.execute("call-6", { path: "image.png" }, undefined, undefined, { cwd, model: { input: ["image"] } } as never);

	assert.deepEqual(seenCwds, [cwd]);
	assert.equal(imagePath, join(seenCwds[0]!, "image.png"));
});

test("createViewImageTool rejects models without image input support", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	const imagePath = join(cwd, "image.png");
	await writeFile(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const tool = createViewImageTool();

	await assert.rejects(
		() => tool.execute("call-7", { path: imagePath }, undefined, undefined, { cwd, model: { input: ["text"] } } as never),
		/view_image is not allowed because you do not support image inputs/,
	);
});
