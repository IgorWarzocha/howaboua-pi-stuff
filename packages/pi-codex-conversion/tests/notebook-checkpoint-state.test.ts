import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeNotebookCheckpoint } from "../src/tools/notebook-mode/checkpoint.ts";
import type { DenoJupyterKernel } from "../src/tools/notebook-mode/jupyter-kernel.ts";

test("session checkpoints retain the project baseline used for deletion conflicts", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-notebook-checkpoint-state-"));
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
			async readTextFile(path: string) { return readFileSync(path, "utf8"); },
			async writeTextFile(path: string, text: string) { writeFileSync(path, text); },
			async rename(from: string, to: string) { renameSync(from, to); },
			async remove(path: string) { rmSync(path, { force: true }); },
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
			{ project: join(agentDir, "project"), session: "session", agentDir },
			new Set(),
			8 * 1024 * 1024,
			{ generation: "baseline", entries: [{ name: "deletedLater", hash: "hash" }] },
		);
		assert.deepEqual(manifest.projectNames, ["deletedLater"]);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
