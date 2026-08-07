import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	formatApplyPatchSummary,
	renderApplyPatchCall,
} from "../src/tools/apply-patch/rendering.ts";

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
