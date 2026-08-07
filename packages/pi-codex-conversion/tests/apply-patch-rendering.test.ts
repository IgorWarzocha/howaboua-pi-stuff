import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderCodeModeResult } from "../src/tools/code-mode/rendering.ts";
import {
	formatApplyPatchSummary,
	renderApplyPatchCall,
} from "../src/tools/apply-patch/rendering.ts";

const theme = {
	fg: (_role: string, text: string) => text,
	bold: (text: string) => text,
};

function renderText(component: { render(width: number): string[] }): string {
	return component
		.render(120)
		.map((line) => line.trimEnd())
		.join("\n");
}

test("delete-and-readd rewrites render as one edited file", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-apply-patch-render-"));
	try {
		writeFileSync(join(cwd, "target.txt"), "old one\nold two\n");
		const patch = [
			"*** Begin Patch",
			"*** Delete File: target.txt",
			"*** Add File: target.txt",
			"+new one",
			"+new two",
			"*** End Patch",
		].join("\n");

		assert.equal(
			formatApplyPatchSummary(patch, cwd),
			"• Edited target.txt (+2 -2)",
		);
		const rendered = renderApplyPatchCall(patch, cwd);
		assert.match(rendered, /old one/);
		assert.match(rendered, /new one/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("nested script errors render once", () => {
	const error = "apply_patch failed: expected context not found";
	const rendered = renderText(
		renderCodeModeResult(
			{
				content: [{ type: "text", text: `Script error: ${error}` }],
				details: {
					cellId: "1",
					status: "result",
					scriptError: error,
					traces: [
						{
							id: "tool-1",
							name: "apply_patch",
							input: "patch",
							status: "error",
							error,
						},
					],
				},
			},
			{ expanded: false, isPartial: false },
			theme,
		),
	);

	assert.equal(rendered.match(/expected context not found/g)?.length, 1);
});
