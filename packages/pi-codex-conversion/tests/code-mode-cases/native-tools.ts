import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCodeModeHarness } from "../helpers/code-mode-harness.ts";

test("Code Mode invokes native patch and image tools directly", async () => {
	const fixture = await createCodeModeHarness();
	const { tools } = fixture;
	const patchDir = await mkdtemp(join(tmpdir(), "pi-code-mode-patch-"));
	const exec = tools.get("exec");
	try {
		await writeFile(join(patchDir, "seed.txt"), "BEFORE\n");
		const patched = await exec.execute(
			"exec-patch",
			{
				code: `await tools.apply_patch("*** Begin Patch\\n*** Update File: seed.txt\\n@@\\n-BEFORE\\n+AFTER\\n*** End Patch");`,
			},
			undefined,
			undefined,
			{
				cwd: patchDir,
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text"],
				},
			} as never,
		);
		assert.equal(await readFile(join(patchDir, "seed.txt"), "utf8"), "AFTER\n");
		assert.equal(patched.details.traces[0].name, "apply_patch");
		assert.equal(typeof patched.details.traces[0].input, "string");
		assert.match(
			exec
				.renderResult(
					patched,
					{ expanded: false, isPartial: false },
					{
						fg: (_role: string, text: string) => text,
						bold: (text: string) => text,
					},
					{ toolCallId: "exec-patch", cwd: patchDir },
				)
				.render(120)
				.join("\n"),
			/Edited seed\.txt/,
		);
		const shellPatched = await exec.execute(
			"exec-shell-patch",
			{
				code: `const result = await tools.exec_command({ cmd: "apply_patch <<'PATCH'\\n*** Begin Patch\\n*** Update File: seed.txt\\n@@\\n-AFTER\\n+SHELL_AFTER\\n*** End Patch\\nPATCH" });\nif (typeof result !== "string") throw new Error("apply_patch was not intercepted");`,
			},
			undefined,
			undefined,
			{ cwd: patchDir, model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna", input: ["text"] } } as never,
		);
		assert.equal(await readFile(join(patchDir, "seed.txt"), "utf8"), "SHELL_AFTER\n");
		assert.equal(shellPatched.details.traces[0].name, "exec_command");
		assert.equal(shellPatched.details.traces[0].status, "done");
		const imagePath = join(patchDir, "pixel.png");
		await writeFile(
			imagePath,
			Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"),
		);
		const viewed = await exec.execute(
			"exec-view-image",
			{ code: `image(await tools.view_image({ path: ${JSON.stringify(imagePath)}, detail: "original" }));` },
			undefined,
			undefined,
			{
				cwd: patchDir,
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text", "image"],
				},
			} as never,
		);
		assert.equal(viewed.details.traces[0].name, "view_image");
		assert.equal(viewed.details.traces[0].status, "done");
		assert.ok(viewed.content.some((item: { type: string }) => item.type === "image"));
	} finally {
		await fixture.close();
		await rm(patchDir, { recursive: true, force: true });
	}
});
