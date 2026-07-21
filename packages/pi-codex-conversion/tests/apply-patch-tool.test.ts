import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clearApplyPatchRenderState, registerApplyPatchTool } from "../src/tools/apply-patch/tool.ts";

function createRegisteredTool() {
	let tool:
		| {
				execute?: (
					toolCallId: string,
					params: Record<string, unknown>,
					signal?: AbortSignal,
					onUpdate?: unknown,
					ctx?: { cwd: string },
				) => Promise<unknown>;
			prepareArguments?: (args: unknown) => { input: string };
	  }
		| undefined;
	const pi = {
		registerTool(definition: typeof tool) {
			tool = definition;
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		getTool() {
			assert.ok(tool);
			return tool;
		},
	};
}

test("apply_patch reports partial failures with recovery metadata", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);

	try {
		const patch = `*** Begin Patch
*** Add File: created.txt
+hello
*** Update File: missing.txt
@@
-old
+new
*** End Patch`;
		const tool = getTool();
		const execute = tool.execute;
		assert.ok(execute);

		const result = (await execute("call-partial-failure", { input: patch }, undefined, undefined, { cwd })) as {
			content: Array<{ type: string; text?: string }>;
			details?: {
				failedFiles?: string[];
				appliedFiles?: string[];
				recoveryInstructions?: { mustReadFiles?: string[]; mustNotReadFiles?: string[] };
			};
		};
		assert.equal(result.content[0]!?.type, "text");
		const output = result.content[0]!?.text ?? "";
		assert.match(output, /partially failed/i);
		assert.match(output, /MUST read missing\.txt before retrying/);
		assert.match(output, /Earlier file actions in this patch were already applied/);
		assert.match(output, /MUST NOT reread other files from this patch unless a specific dependency requires it/);
		assert.doesNotMatch(output, /before retrying\./);
		assert.doesNotMatch(output, /applied\./);
		assert.doesNotMatch(output, /requires it\./);
		assert.deepEqual(result.details?.failedFiles, ["missing.txt"]);
		assert.deepEqual(result.details?.appliedFiles, ["created.txt"]);
		assert.deepEqual(result.details?.recoveryInstructions?.mustReadFiles, ["missing.txt"]);
		assert.deepEqual(result.details?.recoveryInstructions?.mustNotReadFiles, ["created.txt"]);
		assert.notStrictEqual(result.details?.recoveryInstructions?.mustReadFiles, result.details?.failedFiles);
		assert.notStrictEqual(result.details?.recoveryInstructions?.mustNotReadFiles, result.details?.appliedFiles);
	} finally {
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("apply_patch explains out-of-order hunk recovery and preserves other errors", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const filePath = join(cwd, "ordered.txt");
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);

	try {
		writeFileSync(filePath, "one\ntwo\nthree\nfour\n", "utf8");
		const patch = `*** Begin Patch
*** Update File: ordered.txt
@@
-four
+FOUR
@@
-two
+TWO
*** End Patch`;
		const execute = getTool().execute;
		assert.ok(execute);

		await assert.rejects(
			execute("call-out-of-order", { input: patch }, undefined, undefined, { cwd }),
			(error: Error) => {
				assert.equal(error.message.match(/Failed to find expected lines/g)?.length, 1);
				assert.match(error.message, /order each Update File's hunks top-to-bottom/);
				assert.match(error.message, /copy exact indentation/);
				return true;
			},
		);
		assert.equal(await readFile(filePath, "utf8"), "one\ntwo\nthree\nfour\n");

		await assert.rejects(
			execute("call-invalid-patch", { input: "not a patch" }, undefined, undefined, { cwd }),
			(error: Error) => {
				assert.match(error.message, /The first line of the patch must be '\*\*\* Begin Patch'/);
				assert.doesNotMatch(error.message, /hunks top-to-bottom/);
				return true;
			},
		);
	} finally {
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("apply_patch move succeeds through the Rust shim", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const sourcePath = join(cwd, "source.txt");
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);

	try {
		writeFileSync(sourcePath, "from\n", "utf8");
		const patch = `*** Begin Patch
*** Update File: source.txt
*** Move to: moved/source.txt
@@
-from
+to
*** End Patch`;
		const result = (await getTool().execute?.("call-move-partial-failure", { input: patch }, undefined, undefined, { cwd })) as {
			content: Array<{ type: string; text?: string }>;
			details?: {
				status?: string;
				result?: { movedFiles?: string[] };
			};
		};

		assert.match(result.content[0]!?.text ?? "", /Applied patch successfully/i);
		assert.equal(result.details?.status, "success");
		assert.deepEqual(result.details?.result?.movedFiles, ["source.txt -> moved/source.txt"]);
		assert.equal(await readFile(join(cwd, "moved/source.txt"), "utf8"), "to\n");
	} finally {
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
});
