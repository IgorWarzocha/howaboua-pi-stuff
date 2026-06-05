import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { imageContentFromCodexViewImageOutput, imageContentsFromCodexViewImageOutput, registerExecCommandTool } from "../src/tools/exec-command-tool.ts";
import { createExecCommandTracker } from "../src/tools/exec-command-state.ts";
import { createExecSessionManager } from "../src/tools/exec-session-manager.ts";

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("bundled view_image emits Codex code-mode result JSON", () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-view-image-"));
	const imagePath = join(cwd, "image.png");
	writeFileSync(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const output = execFileSync("./bin/view_image", [JSON.stringify({ path: imagePath, detail: "original" })], {
		cwd: packageRoot,
		encoding: "utf8",
	});
	const parsed = JSON.parse(output);

	assert.equal(parsed.detail, "original");
	assert.equal(parsed.image_url, `data:image/png;base64,${PNG_BASE64}`);
});

test("bundled view_image accepts JSON from stdin", () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-view-image-"));
	const imagePath = join(cwd, "image.png");
	writeFileSync(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const output = execFileSync("./bin/view_image", ["-"], {
		cwd: packageRoot,
		encoding: "utf8",
		input: JSON.stringify({ path: imagePath }),
	});
	const parsed = JSON.parse(output);

	assert.equal(parsed.detail, "high");
	assert.equal(parsed.image_url, `data:image/png;base64,${PNG_BASE64}`);
});

test("exec_command recognizes Codex view_image JSON as image content", () => {
	assert.deepEqual(imageContentFromCodexViewImageOutput(JSON.stringify({ image_url: `data:image/png;base64,${PNG_BASE64}`, detail: "high" })), {
		type: "image",
		mimeType: "image/png",
		data: PNG_BASE64,
		detail: "high",
	});
	assert.equal(imageContentFromCodexViewImageOutput("not json"), undefined);
	assert.deepEqual(
		imageContentsFromCodexViewImageOutput([
			JSON.stringify({ image_url: `data:image/png;base64,${PNG_BASE64}`, detail: "high" }),
			JSON.stringify({ image_url: `data:image/png;base64,${PNG_BASE64}`, detail: "original" }),
		].join("\n")),
		[
			{ type: "image", mimeType: "image/png", data: PNG_BASE64, detail: "high" },
			{ type: "image", mimeType: "image/png", data: PNG_BASE64, detail: "original" },
		],
	);
});

test("exec_command converts multiple PATH view_image calls in one shell command", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-view-image-"));
	const firstImagePath = join(cwd, "first.png");
	const secondImagePath = join(cwd, "second.png");
	writeFileSync(firstImagePath, Buffer.from(PNG_BASE64, "base64"));
	writeFileSync(secondImagePath, Buffer.from(PNG_BASE64, "base64"));

	let tool: any;
	const sessions = createExecSessionManager();
	try {
		registerExecCommandTool({ registerTool(definition: unknown) { tool = definition; } } as never, createExecCommandTracker(), sessions);

		const result = await tool.execute(
			"call-1",
			{
				cmd: `PATH=${JSON.stringify(join(packageRoot, "bin"))}:$PATH view_image ${JSON.stringify(JSON.stringify({ path: firstImagePath }))} && view_image ${JSON.stringify(JSON.stringify({ path: secondImagePath, detail: "original" }))}`,
			},
			undefined,
			undefined,
			{ cwd, model: { input: ["text", "image"] } },
		);

		assert.deepEqual(result.content.slice(1), [
			{ type: "image", mimeType: "image/png", data: PNG_BASE64, detail: "high" },
			{ type: "image", mimeType: "image/png", data: PNG_BASE64, detail: "original" },
		]);
		assert.equal(result.details.output, "<image output>");
	} finally {
		sessions.shutdown();
	}
});

test("exec_command bypasses truncation for PATH view_image output", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-view-image-"));
	const imagePath = join(cwd, "image.png");
	writeFileSync(imagePath, Buffer.from(PNG_BASE64, "base64"));

	let tool: any;
	const sessions = createExecSessionManager();
	try {
		registerExecCommandTool({ registerTool(definition: unknown) { tool = definition; } } as never, createExecCommandTracker(), sessions);

		const result = await tool.execute(
			"call-1",
			{
				cmd: `PATH=${JSON.stringify(join(packageRoot, "bin"))}:$PATH view_image ${JSON.stringify(JSON.stringify({ path: imagePath }))}`,
				max_output_tokens: 1,
			},
			undefined,
			undefined,
			{ cwd, model: { input: ["text", "image"] } },
		);

		assert.deepEqual(result.content, [
			{ type: "text", text: `Command: PATH=${JSON.stringify(join(packageRoot, "bin"))}:$PATH view_image ${JSON.stringify(JSON.stringify({ path: imagePath }))}\nChunk ID: ${result.details.chunk_id}\nWall time: ${result.details.wall_time_seconds.toFixed(4)} seconds\nProcess exited with code 0\nOutput:\n<image output>` },
			{ type: "image", mimeType: "image/png", data: PNG_BASE64, detail: "high" },
		]);
		assert.equal(result.details.output, "<image output>");
		assert.equal(result.details.original_token_count, undefined);
	} finally {
		sessions.shutdown();
	}
});

test("exec_command parses PATH view_image output when model input metadata is absent", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-view-image-"));
	const imagePath = join(cwd, "image.png");
	writeFileSync(imagePath, Buffer.from(PNG_BASE64, "base64"));

	let tool: any;
	const sessions = createExecSessionManager();
	try {
		registerExecCommandTool({ registerTool(definition: unknown) { tool = definition; } } as never, createExecCommandTracker(), sessions);

		const result = await tool.execute(
			"call-1",
			{
				cmd: `PATH=${JSON.stringify(join(packageRoot, "bin"))}:$PATH view_image ${JSON.stringify(JSON.stringify({ path: imagePath }))}`,
				max_output_tokens: 1,
			},
			undefined,
			undefined,
			{ cwd, model: { id: "gpt-5.5" } },
		);

		assert.deepEqual(result.content[1], { type: "image", mimeType: "image/png", data: PNG_BASE64, detail: "high" });
		assert.equal(result.details.output, "<image output>");
	} finally {
		sessions.shutdown();
	}
});

test("exec_command compacts PATH web.run JSON output", async () => {
	const sessions = createExecSessionManager();
	try {
		let tool: any;
		registerExecCommandTool({ registerTool(definition: unknown) { tool = definition; } } as never, createExecCommandTracker(), sessions);
		const json = JSON.stringify({
			text: "Answer from search.",
			citations: [{ title: "Docs", url: "https://example.com/docs" }],
			web_search_calls: [{ rawSearchData: "hidden" }],
		});
		const result = await tool.execute(
			"call-1",
			{ cmd: `printf '%s' ${JSON.stringify(json)} # web.run`, max_output_tokens: 1 },
			new AbortController().signal,
			undefined,
			{ cwd: packageRoot, model: {} } as never,
		);
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		assert.match(text, /Answer from search\./);
		assert.match(text, /https:\/\/example\.com\/docs/);
		assert.doesNotMatch(result.details.output, /rawSearchData/);
		assert.equal(result.details.original_token_count, undefined);
	} finally {
		sessions.shutdown();
	}
});

test("exec_command compacts PATH image_gen.imagegen output and displays image content", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-imagegen-"));
	const imagePath = join(cwd, "generated.png");
	writeFileSync(imagePath, Buffer.from(PNG_BASE64, "base64"));
	const sessions = createExecSessionManager();
	try {
		let tool: any;
		registerExecCommandTool({ registerTool(definition: unknown) { tool = definition; } } as never, createExecCommandTracker(), sessions);
		const json = JSON.stringify({
			path: ".pi/openai-codex-images/generated.png",
			latest_path: ".pi/openai-codex-images/latest.png",
			images: [{ path: ".pi/openai-codex-images/generated.png", absolute_path: imagePath }],
			background: "opaque",
			quality: "medium",
			size: "1254x1254",
		});
		const result = await tool.execute(
			"call-1",
			{ cmd: `printf '%s' ${JSON.stringify(json)} # image_gen.imagegen`, max_output_tokens: 1 },
			new AbortController().signal,
			undefined,
			{ cwd, model: { input: ["text", "image"] } } as never,
		);

		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		assert.match(text, /Generated image: \.pi\/openai-codex-images\/generated\.png/);
		assert.match(text, /Latest: \.pi\/openai-codex-images\/latest\.png/);
		assert.deepEqual(result.content[1], { type: "image", mimeType: "image/png", data: PNG_BASE64, detail: "high" });
		assert.equal(result.details.original_token_count, undefined);
	} finally {
		sessions.shutdown();
	}
});
