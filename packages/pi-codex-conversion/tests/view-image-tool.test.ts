import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createViewImageTool, parseViewImageParams } from "../src/tools/view-image/tool.ts";

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";


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

test("createViewImageTool uses Rust view_image resized mode by default", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	const imagePath = join(cwd, "image.png");
	await writeFile(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const tool = createViewImageTool({ allowOriginalDetail: true });

	const result = await tool.execute("call-1", { path: "image.png" }, undefined, undefined, {
		cwd,
		model: { input: ["image"] },
	} as never);

	assert.equal(result.content.length, 1);
	assert.deepEqual(result.content[0]!, { type: "image", data: PNG_BASE64, mimeType: "image/png", detail: "high" });
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
