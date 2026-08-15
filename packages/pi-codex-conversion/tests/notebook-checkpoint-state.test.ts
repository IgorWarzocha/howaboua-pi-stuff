import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { writeNotebookCheckpoint } from "../src/tools/notebook-mode/checkpoint.ts";
import type { DenoJupyterKernel } from "../src/tools/notebook-mode/jupyter-kernel.ts";

test("session checkpoints retain their project baseline without trusting old cleanup paths", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-notebook-checkpoint-state-"));
	const project = join(agentDir, "project");
	const session = "session";
	const key = createHash("sha256").update(`${resolve(project)}\0${session}`).digest("hex");
	const directory = join(agentDir, "cache", "pi-codex-conversion", "notebook-mode", "sessions", key);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "checkpoint.json"), JSON.stringify({
		schema: 1,
		project,
		session,
		deno: "2.9.5",
		v8: "test",
		payload: "../../outside.bin",
		createdAt: new Date().toISOString(),
		entries: [],
		skipped: [],
	}));
	const removed: string[] = [];
	const execute = async (source: string) => {
		const deno = {
			version: { deno: "2.9.5", v8: "test" },
			async open(path: string) {
				writeFileSync(path, Buffer.alloc(0));
				return {
					async write(bytes: Uint8Array) {
						appendFileSync(path, bytes);
						return bytes.byteLength;
					},
					close() {},
				};
			},
			async writeTextFile(path: string, text: string) { writeFileSync(path, text); },
			async rename(from: string, to: string) { renameSync(from, to); },
			async remove(path: string) { removed.push(path); rmSync(path, { force: true }); },
		};
		const run = new Function("Deno", "crypto", `return (async () => ${source})()`);
		await run(deno, { randomUUID });
		return { status: "ok" as const, items: [] };
	};
	const kernel = {
		complete: async () => [],
		execute,
	} as unknown as DenoJupyterKernel;
	try {
		const manifest = await writeNotebookCheckpoint(
			kernel,
			{ project, session, agentDir },
			new Set(),
			8 * 1024 * 1024,
			{ generation: "baseline", entries: [{ name: "deletedLater", hash: "hash" }] },
		);
		assert.deepEqual(manifest.projectNames, ["deletedLater"]);
		assert.deepEqual(removed, []);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
