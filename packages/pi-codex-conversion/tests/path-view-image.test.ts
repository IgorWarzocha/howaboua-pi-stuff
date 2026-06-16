import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerExecCommandTool } from "../src/tools/exec/command-tool.ts";
import { createExecCommandTracker } from "../src/tools/exec/command-state.ts";
import { createExecSessionManager } from "../src/tools/exec/session-manager.ts";

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function codexPathContext(cwd: string, model: Record<string, unknown> = {}) {
	return {
		cwd,
		model: { id: "gpt-5.5", provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api/codex", ...model },
		modelRegistry: {
			async getApiKeyAndHeaders() {
				return { ok: true, apiKey: "token", headers: { "chatgpt-account-id": "account" } };
			},
		},
	} as never;
}


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
				cmd: `PATH=${JSON.stringify(join(packageRoot, "bin"))}:$PATH; view_image ${JSON.stringify(JSON.stringify({ path: firstImagePath }))} && view_image ${JSON.stringify(JSON.stringify({ path: secondImagePath }))}`,
			},
			undefined,
			undefined,
			{ cwd, model: { input: ["text", "image"] } },
		);

		assert.deepEqual(result.content.slice(1), [
			{ type: "image", mimeType: "image/png", data: PNG_BASE64, detail: "original" },
			{ type: "image", mimeType: "image/png", data: PNG_BASE64, detail: "original" },
		]);
		assert.equal(result.details.output, "<image output>");
	} finally {
		sessions.shutdown();
	}
});

test("exec_command compacts PATH web_run JSON output", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-web-run-"));
	const webRunPath = join(cwd, "web_run");
	const json = JSON.stringify({
		text: "Answer from search.",
		citations: [{ title: "Docs", url: "https://example.com/docs" }],
		web_search_calls: [{ rawSearchData: "hidden" }],
	});
	writeFileSync(webRunPath, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(json)})\n`, { mode: 0o755 });
	const sessions = createExecSessionManager();
	try {
		let tool: any;
		registerExecCommandTool({ registerTool(definition: unknown) { tool = definition; } } as never, createExecCommandTracker(), sessions);
		const result = await tool.execute(
			"call-1",
			{ cmd: `PATH=${JSON.stringify(cwd)}:$PATH web_run`, max_output_tokens: 1 },
			new AbortController().signal,
			undefined,
			codexPathContext(cwd),
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


test("exec_command compacts PATH imagegen output and displays image content", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "path-imagegen-"));
	const imagePath = join(cwd, "generated.png");
	const imagegenPath = join(cwd, "imagegen");
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
		writeFileSync(imagegenPath, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(json)})\n`, { mode: 0o755 });
		const result = await tool.execute(
			"call-1",
			{ cmd: `PATH=${JSON.stringify(cwd)}:$PATH imagegen`, max_output_tokens: 1 },
			new AbortController().signal,
			undefined,
			codexPathContext(cwd, { input: ["text", "image"] }),
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
