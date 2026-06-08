import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { patchFsOps } from "../src/patch/core.ts";
import { clearApplyPatchRenderState, registerApplyPatchTool } from "../src/tools/apply-patch-tool.ts";

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

test("apply_patch uses Pi's default shell renderer", () => {
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);

	assert.equal("renderShell" in getTool(), false);
});

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

test("apply_patch renderCall preserves deleted previews after execution removes the file", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);
	const theme = createTheme();

	try {
		writeFileSync(join(cwd, "delete-me.txt"), "first\nsecond\n", "utf8");
		const patch = `*** Begin Patch
*** Delete File: delete-me.txt
*** End Patch`;

		await getTool().execute?.("call-delete", { input: patch }, undefined, undefined, { cwd });
		await assert.rejects(readFile(join(cwd, "delete-me.txt"), "utf8"));

		const rendered = renderComponentText(
			getTool().renderCall?.({ input: patch }, theme, { toolCallId: "call-delete", expanded: true }),
		);

		assert.match(rendered, /Deleted delete-me\.txt \(\+0 -2\)/);
		assert.match(rendered, /-first/);
		assert.match(rendered, /-second/);
	} finally {
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("apply_patch renderCall falls back to the patching placeholder while patch args are incomplete", () => {
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);
	const theme = createTheme();

	const rendered = renderComponentText(
		getTool().renderCall?.(
			{ input: "*** Begin Patch\n*** Add File: foo.txt\n+hello" },
			theme,
			{ toolCallId: "call-incomplete-patch", expanded: false, argsComplete: false },
		),
	);

	assert.equal(rendered, "• Patching");
});

test("apply_patch renderCall shows edit failed after a non-partial patch failure", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);
	const theme = createTheme();

	try {
		const patch = `*** Begin Patch
*** Frobnicate File: nope.txt
*** End Patch`;
		const tool = getTool();
		const execute = tool.execute;
		const renderCall = tool.renderCall;
		assert.ok(execute);
		assert.ok(renderCall);

		await assert.rejects(() => execute("call-failed-patch", { input: patch }, undefined, undefined, { cwd }));

		const rendered = renderComponentText(renderCall({ input: patch }, theme, { toolCallId: "call-failed-patch", expanded: false, cwd }));
		assert.equal(rendered, "• Edit failed");
	} finally {
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
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

test("apply_patch keeps applying later files after one file fails", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);

	try {
		const result = (await getTool().execute?.(
			"call-continue-after-failure",
			{
				input: `*** Begin Patch
*** Add File: created.txt
+hello
*** Update File: missing.txt
@@
-old
+new
*** Add File: later.txt
+world
*** End Patch`,
			},
			undefined,
			undefined,
			{ cwd },
		)) as {
			content: Array<{ type: string; text?: string }>;
			details?: {
				failedFiles?: string[];
				appliedFiles?: string[];
				recoveryInstructions?: { mustReadFiles?: string[]; mustNotReadFiles?: string[] };
			};
		};

		assert.match(result.content[0]!?.text ?? "", /partially failed/i);
		assert.deepEqual(result.details?.failedFiles, ["missing.txt"]);
		assert.deepEqual(result.details?.appliedFiles?.sort(), ["created.txt", "later.txt"]);
		assert.deepEqual(result.details?.recoveryInstructions?.mustReadFiles, ["missing.txt"]);
		assert.deepEqual(result.details?.recoveryInstructions?.mustNotReadFiles?.sort(), ["created.txt", "later.txt"]);
		assert.equal(await readFile(join(cwd, "created.txt"), "utf8"), "hello\n");
		assert.equal(await readFile(join(cwd, "later.txt"), "utf8"), "world\n");
	} finally {
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("apply_patch renderCall marks failed absolute-path entries inline using display paths", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);
	const theme = createTheme();

	try {
		const createdPath = join(cwd, "created.txt");
		const missingPath = join(cwd, "missing.txt");
		const patch = `*** Begin Patch
*** Add File: ${createdPath}
+hello
*** Update File: ${missingPath}
@@
-old
+new
*** End Patch`;
		const tool = getTool();
		const execute = tool.execute;
		const renderCall = tool.renderCall;
		assert.ok(execute);
		assert.ok(renderCall);

		const result = (await execute("call-absolute-partial-failure", { input: patch }, undefined, undefined, { cwd })) as {
			content: Array<{ type: string; text?: string }>;
		};
		assert.match(result.content[0]!?.text ?? "", /while patching missing\.txt/);

		const collapsed = renderComponentText(
			renderCall({ input: patch }, theme, { toolCallId: "call-absolute-partial-failure", expanded: false, cwd }),
		);

		assert.match(collapsed, /^• Edit partially failed 2 files \(\+2 -1\)/);
		assert.match(collapsed, /missing\.txt failed \(\+1 -1\)/);
	} finally {
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("apply_patch renderCall only marks the exact failed entry inline", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);
	const theme = createTheme();

	try {
		const patch = `*** Begin Patch
*** Add File: foo.txt.bak
+ok
*** Update File: foo.txt
@@
-old
+new
*** End Patch`;
		const tool = getTool();
		const execute = tool.execute;
		const renderCall = tool.renderCall;
		assert.ok(execute);
		assert.ok(renderCall);

		await execute("call-substring-partial-failure", { input: patch }, undefined, undefined, { cwd });

		const collapsed = renderComponentText(
			renderCall({ input: patch }, theme, { toolCallId: "call-substring-partial-failure", expanded: false, cwd }),
		);

		assert.match(collapsed, /foo\.txt failed \(\+1 -1\)/);
		assert.doesNotMatch(collapsed, /foo\.txt failed\.bak/);
		assert.match(collapsed, /foo\.txt\.bak \(\+1 -0\)/);
	} finally {
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("apply_patch renderCall preserves the original preview for runtime partial failures", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const sourcePath = join(cwd, "source.txt");
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);
	const theme = createTheme();
	const originalUnlinkSync = patchFsOps.unlinkSync;

	try {
		writeFileSync(sourcePath, "from\n", "utf8");
		patchFsOps.unlinkSync = (path) => {
			if (String(path) === sourcePath) {
				throw new Error("mock unlink failure");
			}
			return originalUnlinkSync(path);
		};
		const patch = `*** Begin Patch
*** Update File: source.txt
*** Move to: moved/source.txt
@@
-from
+to
*** End Patch`;
		const tool = getTool();
		const execute = tool.execute;
		const renderCall = tool.renderCall;
		assert.ok(execute);
		assert.ok(renderCall);

		try {
			await execute("call-preview-partial-failure", { input: patch }, undefined, undefined, { cwd });
		} finally {
			patchFsOps.unlinkSync = originalUnlinkSync;
		}

		const expanded = renderComponentText(
			renderCall({ input: patch }, theme, { toolCallId: "call-preview-partial-failure", expanded: true, cwd }),
		);

		assert.match(expanded, /source\.txt → moved\/source\.txt failed \(\+1 -1\)/);
		assert.match(expanded, /-from/);
		assert.match(expanded, /\+to/);
	} finally {
		patchFsOps.unlinkSync = originalUnlinkSync;
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("apply_patch partial move failures report real paths and no prior-action warning", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const sourcePath = join(cwd, "source.txt");
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);
	const originalUnlinkSync = patchFsOps.unlinkSync;

	try {
		writeFileSync(sourcePath, "from\n", "utf8");
		patchFsOps.unlinkSync = (path) => {
			if (String(path) === sourcePath) {
				throw new Error("mock unlink failure");
			}
			return originalUnlinkSync(path);
		};
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
				failedFiles?: string[];
				appliedFiles?: string[];
				recoveryInstructions?: { mustReadFiles?: string[]; mustNotReadFiles?: string[] };
			};
		};

		assert.match(result.content[0]!?.text ?? "", /while patching source\.txt → moved\/source\.txt/i);
		assert.match(result.content[0]!?.text ?? "", /Failed files: source\.txt, moved\/source\.txt/i);
		assert.match(result.content[0]!?.text ?? "", /MUST read source\.txt, moved\/source\.txt before retrying\./i);
		assert.doesNotMatch(result.content[0]!?.text ?? "", /Earlier file actions in this patch were already applied\./i);
		assert.deepEqual(result.details?.failedFiles, ["source.txt", "moved/source.txt"]);
		assert.deepEqual(result.details?.appliedFiles, []);
		assert.deepEqual(result.details?.recoveryInstructions?.mustReadFiles, ["source.txt", "moved/source.txt"]);
		assert.deepEqual(result.details?.recoveryInstructions?.mustNotReadFiles, []);
	} finally {
		patchFsOps.unlinkSync = originalUnlinkSync;
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("apply_patch renderCall marks single-file partial failures after warning styling", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-codex-conversion-"));
	const sourcePath = join(cwd, "source.txt");
	const { pi, getTool } = createRegisteredTool();
	registerApplyPatchTool(pi);
	const theme = createTheme();
	const originalUnlinkSync = patchFsOps.unlinkSync;

	try {
		writeFileSync(sourcePath, "from\n", "utf8");
		patchFsOps.unlinkSync = (path) => {
			if (String(path) === sourcePath) {
				throw new Error("mock unlink failure");
			}
			return originalUnlinkSync(path);
		};
		const patch = `*** Begin Patch
*** Update File: source.txt
*** Move to: moved/source.txt
@@
-from
+to
*** End Patch`;
		const tool = getTool();
		const execute = tool.execute;
		const renderCall = tool.renderCall;
		assert.ok(execute);
		assert.ok(renderCall);

		try {
			await execute("call-single-file-partial-failure", { input: patch }, undefined, undefined, { cwd });
		} finally {
			patchFsOps.unlinkSync = originalUnlinkSync;
		}

		const collapsed = renderComponentText(
			renderCall({ input: patch }, theme, { toolCallId: "call-single-file-partial-failure", expanded: false, cwd }),
		);

		assert.match(collapsed, /^• Edit partially failed source\.txt → moved\/source\.txt failed \(\+1 -1\)/);
	} finally {
		clearApplyPatchRenderState();
		await rm(cwd, { recursive: true, force: true });
	}
});
