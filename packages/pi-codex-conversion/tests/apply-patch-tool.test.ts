import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clearApplyPatchRenderState, registerApplyPatchTool } from "../src/tools/apply-patch/tool.ts";

function createTheme() {
	return {
		fg: (_role: string, text: string) => text,
		bold: (text: string) => text,
	};
}

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function renderComponentText(component: { render(width: number): string[] } | undefined): string {
	assert.ok(component);
	return stripAnsi(
		component
			.render(120)
			.map((line) => line.trimEnd())
			.join("\n")
			.trim(),
	);
}

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
				renderCall?: (
					args: { input?: string },
					theme: ReturnType<typeof createTheme>,
					context?: { toolCallId?: string; expanded?: boolean; cwd?: string; argsComplete?: boolean },
				) => { render(width: number): string[] };
				renderResult?: (
					result: { content: Array<{ type: string; text?: string }>; details?: unknown },
					options: { expanded: boolean; isPartial: boolean },
					theme: ReturnType<typeof createTheme>,
				) => { render(width: number): string[] };
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

test("apply_patch prepareArguments accepts legacy patch aliases", () => {
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);

	assert.deepEqual(getTool().prepareArguments?.({ patchText: "*** Begin Patch\n*** End Patch" }), {
		input: "*** Begin Patch\n*** End Patch",
	});
	assert.deepEqual(getTool().prepareArguments?.({ patch: "*** Begin Patch\n*** End Patch" }), {
		input: "*** Begin Patch\n*** End Patch",
	});
});

test("apply_patch renderCall shows partial failure inline after some hunks already applied", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);
	const theme = createTheme();

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
		const renderCall = tool.renderCall;
		assert.ok(execute);
		assert.ok(renderCall);

		const result = (await execute("call-partial-failure", { input: patch }, undefined, undefined, { cwd })) as {
			content: Array<{ type: string; text?: string }>;
			details?: {
				failedFiles?: string[];
				appliedFiles?: string[];
				recoveryInstructions?: { mustReadFiles?: string[]; mustNotReadFiles?: string[] };
			};
		};
		assert.equal(result.content[0]!?.type, "text");
		assert.match(result.content[0]!?.text ?? "", /partially failed/i);
		assert.match(result.content[0]!?.text ?? "", /MUST read missing\.txt before retrying\./);
		assert.match(result.content[0]!?.text ?? "", /Earlier file actions in this patch were already applied\./);
		assert.match(result.content[0]!?.text ?? "", /MUST NOT reread other files from this patch unless a specific dependency requires it\./);
		assert.deepEqual(result.details?.failedFiles, ["missing.txt"]);
		assert.deepEqual(result.details?.appliedFiles, ["created.txt"]);
		assert.deepEqual(result.details?.recoveryInstructions?.mustReadFiles, ["missing.txt"]);
		assert.deepEqual(result.details?.recoveryInstructions?.mustNotReadFiles, ["created.txt"]);

		const collapsed = renderComponentText(
			renderCall({ input: patch }, theme, { toolCallId: "call-partial-failure", expanded: false }),
		);
		const expanded = renderComponentText(
			renderCall({ input: patch }, theme, { toolCallId: "call-partial-failure", expanded: true }),
		);

		assert.match(collapsed, /^• Edit partially failed 2 files \(\+2 -1\)/);
		assert.match(collapsed, /missing\.txt failed \(\+1 -1\)/);
		assert.match(expanded, /^• Edit partially failed 2 files \(\+2 -1\)/);
		assert.match(expanded, /created\.txt \(\+1 -0\)/);
		assert.match(expanded, /missing\.txt failed \(\+1 -1\)/);
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
