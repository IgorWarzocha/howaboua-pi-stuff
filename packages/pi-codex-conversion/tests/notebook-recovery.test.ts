import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NotebookExecutionRuntime } from "../src/tools/notebook-mode/execution-runtime.ts";
import { NotebookLifecycleController } from "../src/tools/notebook-mode/lifecycle.ts";
import { formatNotebookDiagnostics, type NotebookDiagnostic } from "../src/tools/notebook-mode/notebook-diagnostics.ts";
import { NotebookRecoveryController } from "../src/tools/notebook-mode/recovery.ts";
import { PROJECT_STATE_SCHEMA, projectStatePaths, readProjectStateManifest, type ProjectStateManifest } from "../src/tools/notebook-mode/project-state-format.ts";
import { isNotebookBootstrapFailure } from "../src/tools/notebook-mode/runtime-health.ts";

test("notebook diagnostics group historical duplicates and put runtime health first", () => {
	const diagnostics: NotebookDiagnostic[] = [diagnostic("cell-1", 0), diagnostic("cell-2", 1), diagnostic("cell-3", 2, "other"), diagnostic("cell-4", 3, "r", "error", "ts")];
	const result = formatNotebookDiagnostics("/project/notebook.ipynb", 4, diagnostics, "invalidated");
	assert.match(result.message, /^Notebook runtime health: invalidated;/);
	assert.match(result.message, /Historical static diagnostics/);
	assert.match(result.message, /2 occurrences warning deno-2451 \[r\]/);
	assert.match(result.message, /samples: cell-1 cell 1:1:1, cell-2 cell 2:2:1/);
	assert.doesNotMatch(result.message, /repair these/);
	assert.deepEqual((result.details as { diagnosticGroups: Array<{ count: number; name?: string; severity: string; source?: string }> }).diagnosticGroups.map(({ count, name, severity, source }) => ({ count, name, severity, source })), [
		{ count: 2, name: "r", severity: "warning", source: "deno" },
		{ count: 1, name: "other", severity: "warning", source: "deno" },
		{ count: 1, name: "r", severity: "error", source: "ts" },
	]);
	const bounded = formatNotebookDiagnostics(
		`/${"é".repeat(12_000)}`,
		2_000,
		Array.from({ length: 2_000 }, (_, index) => diagnostic(`cell-${index}`, index, `name-${index}`)),
		"ready",
	);
	assert.ok(Buffer.byteLength(bounded.message, "utf8") <= 16 * 1024);
	assert.ok(Buffer.byteLength(JSON.stringify(bounded.details), "utf8") <= 16 * 1024);
});

test("notebook reset preserves the durable project manifest and pins", async () => {
	const root = join(tmpdir(), `pi-notebook-reset-${process.pid}-${Date.now()}`);
	const project = join(root, "project");
	const agentDir = join(root, "agent");
	const payload = Buffer.from("durable");
	const paths = projectStatePaths(project, agentDir);
	const manifest: ProjectStateManifest = {
		schema: PROJECT_STATE_SCHEMA,
		project,
		generation: "generation-1",
		deno: "2.9.5",
		v8: "test",
		payload: "project-00000000-0000-0000-0000-000000000001.bin",
		createdAt: "2026-01-01T00:00:00.000Z",
		sourceSession: "session",
		entries: [{ name: "prReview", kind: "value", offset: 0, length: payload.length, hash: hash(payload), pinned: true }],
		skipped: [],
	};
	mkdirSync(paths.directory, { recursive: true });
	writeFileSync(join(paths.directory, manifest.payload), payload);
	writeFileSync(paths.manifest, `${JSON.stringify(manifest)}\n`);
	writeFileSync(join(paths.directory, "npm-imports.json"), `${JSON.stringify({ schema: 1, project, imports: ["npm:example@1.2.3"] })}\n`);
	const extensionContext = { cwd: project, sessionManager: { getSessionId: () => "session-id", getBranch: () => [] } };
	const events: string[] = [];
	const controller = new NotebookRecoveryController({ agentDir, maxBytes: 8 * 1024 * 1024 }, {
		stopWithoutCheckpoint: async () => { events.push("stop"); return undefined; },
		startClean: async () => { events.push("start"); },
		checkpointEmpty: async () => { events.push("checkpoint"); },
		configuredProfileActive: () => false,
		runtimeHealth: () => ({ state: "ready" }),
	});
	try {
		const result = await controller.reset({ cwd: project, extensionContext } as never);
		const restored = readProjectStateManifest(paths.manifest);
		assert.equal(restored?.entries[0]?.name, "prReview");
		assert.equal(restored?.entries[0]?.pinned, true);
		assert.deepEqual(JSON.parse(readFileSync(join(paths.directory, "npm-imports.json"), "utf8")).imports, ["npm:example@1.2.3"]);
		assert.deepEqual(events, ["stop", "start", "checkpoint"]);
		assert.match(result.message, /preserved 1 project binding including 1 pinned/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("terminating a notebook cell invalidates its kernel before another cell can use it", async () => {
	assert.equal(isNotebookBootstrapFailure({ errorText: "TypeError: Cannot read properties of undefined (reading 'begin')" }), false);
	assert.equal(isNotebookBootstrapFailure({ errorText: "Notebook runtime bootstrap unavailable: __piNotebook.begin" }), true);
	type FakeResult = { status: "ok" | "aborted"; items: [] };
	let kernel: { execute(): Promise<FakeResult>; interrupt(): Promise<void> } | undefined;
	let interrupts = 0;
	let executeCalls = 0;
	let finish!: (result: FakeResult) => void;
	const pending = new Promise<FakeResult>((resolve) => { finish = resolve; });
	kernel = {
		execute: () => {
			executeCalls += 1;
			return executeCalls === 1
				? new Promise((resolve) => setTimeout(() => resolve({ status: "ok", items: [] }), 50))
				: pending;
		},
		interrupt: async () => { interrupts += 1; finish({ status: "aborted", items: [] }); },
	};
	const session = {
		kernel: () => kernel,
		checkpoints: { flush: async () => {}, schedule: () => {} },
		journal: () => undefined,
		recordMemory: () => {},
		memory: () => undefined,
		takeNotice: () => undefined,
		invalidateKernel: async () => { kernel = undefined; },
		recoverFromBootstrapFailure: async () => false,
	};
	const runtime = new NotebookExecutionRuntime(
		() => session as never,
		async () => {},
	);
	const context = { cwd: "/tmp" };
	const yielded = await runtime.execute('// @exec: {"yield_time_ms": 1}\nawait new Promise(() => {})', context);
	assert.equal(yielded.kind, "yielded");
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(executeCalls, 2);
	assert.equal(runtime.activeCellId(), yielded.cellId);
	const terminated = await runtime.terminate(yielded.cellId, context);
	assert.equal(terminated.kind, "terminated");
	assert.equal(interrupts, 1);
	assert.equal(kernel, undefined);
	assert.equal(runtime.activeCellId(), undefined);

	let quickKernel: { execute(): Promise<FakeResult>; interrupt(): Promise<void> } | undefined;
	let quickExecuteCalls = 0;
	let quickInterrupts = 0;
	quickKernel = {
		execute: () => {
			quickExecuteCalls += 1;
			const delay = quickExecuteCalls === 1 ? 50 : 20;
			return new Promise((resolve) => setTimeout(() => resolve({ status: "ok", items: [] }), delay));
		},
		interrupt: async () => { quickInterrupts += 1; },
	};
	const quickSession = {
		...session,
		kernel: () => quickKernel,
		invalidateKernel: async () => { quickKernel = undefined; },
	};
	const quickRuntime = new NotebookExecutionRuntime(() => quickSession as never, async () => {});
	const quickYielded = await quickRuntime.execute('// @exec: {"yield_time_ms": 1}\nawait new Promise(() => {})', context);
	assert.equal(quickYielded.kind, "yielded");
	await new Promise((resolve) => setTimeout(resolve, 60));
	await quickRuntime.terminate(quickYielded.cellId, context);
	assert.equal(quickExecuteCalls, 2);
	assert.equal(quickInterrupts, 0);
	assert.equal(quickKernel, undefined);
});

test("notebook restart bypasses capture after the runtime is invalidated", async () => {
	let checkpoints = 0;
	let prepares = 0;
	let restarts = 0;
	const controller = new NotebookLifecycleController({
		prepare: async () => { prepares += 1; },
		diagnostics: async () => ({ message: "", details: {} }),
		reset: async () => ({ message: "", details: {} }),
		kernel: () => undefined,
		activeCellId: () => undefined,
		stopActive: async () => undefined,
		checkpoint: async () => { checkpoints += 1; },
		retainedBindings: () => [],
		promoteBindings: async () => async () => {},
		markChanged: () => {},
		restart: async () => { restarts += 1; return undefined; },
		rollback: async () => {},
		baselineNames: () => new Set(),
		profileStorage: () => ({ agentDir: "/tmp", maxBytes: 8 * 1024 * 1024 }),
		runtimeHealth: () => ({ state: "invalidated" }),
		metadata: () => ({ userCells: 0, checkpoint: {} }),
	} as never);

	const result = await controller.control({ action: "restart" }, { cwd: "/tmp", extensionContext: {} } as never);
	assert.equal(checkpoints, 0);
	assert.equal(prepares, 0);
	assert.equal(restarts, 1);
	assert.match(result.message, /restarted from the last completed checkpoint/);
});

function diagnostic(cellId: string, cellIndex: number, name = "r", severity: NotebookDiagnostic["severity"] = "warning", source = "deno"): NotebookDiagnostic {
	return {
		cellId, cellIndex, line: cellIndex + 1, column: 1, endLine: cellIndex + 1, endColumn: 8,
		severity, code: 2451, source, name,
		message: `Cannot redeclare block-scoped variable '${name}'.`,
	};
}

function hash(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}
