import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createViewImageTool, parseViewImageParams } from "../src/tools/view-image-tool.ts";

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

function renderText(component: { render(width: number): string[] } | undefined): string {
	assert.ok(component);
	return component.render(120).map((line) => line.trimEnd()).join("\n");
}

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };

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

test("view_image renders Codex-style label", () => {
	const tool = createViewImageTool({ allowOriginalDetail: true });
	assert.equal(renderText(tool.renderCall?.({ path: "image.png" }, theme as never, {} as never)), "• Viewed Image\n  └ image.png");
});

test("view_image hides redundant collapsed result text", () => {
	const tool = createViewImageTool({ allowOriginalDetail: true });
	assert.equal(
		renderText(tool.renderResult?.({ content: [{ type: "text", text: "Image loaded" }], details: undefined }, { expanded: false, isPartial: false }, theme as never, {} as never)),
		"",
	);
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

test("createViewImageTool uses Rust view_image original mode when requested", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	const imagePath = join(cwd, "image.png");
	await writeFile(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const tool = createViewImageTool({ allowOriginalDetail: true });

	const result = await tool.execute("call-2", { path: "image.png", detail: "original" }, undefined, undefined, {
		cwd,
		model: { input: ["image"] },
	} as never);

	assert.equal(result.content.length, 1);
	assert.deepEqual(result.content[0]!, { type: "image", data: PNG_BASE64, mimeType: "image/png", detail: "original" });
});

test("createViewImageTool rejects missing paths and directories with codex-like errors", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	const dirPath = join(cwd, "screenshots");
	await mkdir(dirPath);

	const tool = createViewImageTool({ allowOriginalDetail: true });

	await assert.rejects(
		() => tool.execute("call-3", { path: "missing.png" }, undefined, undefined, { cwd, model: { input: ["image"] } } as never),
		new RegExp(`unable to locate image at \`${join(cwd, "missing.png").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``),
	);
	await assert.rejects(
		() => tool.execute("call-4", { path: "screenshots" }, undefined, undefined, { cwd, model: { input: ["image"] } } as never),
		new RegExp(`image path \`${dirPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\` is not a file`),
	);
});

test("createViewImageTool rejects non-image files", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	await writeFile(join(cwd, "not-image.txt"), "plain text");

	const tool = createViewImageTool({ allowOriginalDetail: true });

	await assert.rejects(
		() => tool.execute("call-5", { path: "not-image.txt" }, undefined, undefined, { cwd, model: { input: ["image"] } } as never),
		/unable to process image at/,
	);
});

test("createViewImageTool resolves relative paths through Rust process cwd", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "view-image-tool-"));
	const imagePath = join(cwd, "image.png");
	await writeFile(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const tool = createViewImageTool();

	const result = await tool.execute("call-6", { path: "image.png" }, undefined, undefined, { cwd, model: { input: ["image"] } } as never);

	assert.equal(result.content[0]?.type, "image");
	assert.equal(imagePath, join(cwd, "image.png"));
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
