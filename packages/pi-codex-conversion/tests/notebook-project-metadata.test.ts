import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatStatus, type NotebookStatusDetails } from "../src/tools/notebook-mode/lifecycle-result.ts";
import { projectStateCaptureSource, projectStateRestoreSource } from "../src/tools/notebook-mode/project-state-runtime.ts";

test("durable binding metadata ignores getters, survives restore, and is shown by status", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-notebook-project-metadata-"));
	let getterCalls = 0;
	let payload = Buffer.alloc(0);
	let candidate: { deno: string; v8: string; entries: Array<Record<string, unknown>> } | undefined;
	function helper() {
		throw new Error("helper should not run during discovery");
	}
	Object.defineProperty(helper, "description", {
		get() {
			getterCalls += 1;
			throw new Error("description getter invoked");
		},
	});
	Object.defineProperty(helper, "usage", { value: 'await helper("check")' });
	const captureDeno = {
		version: { deno: "2.9.5", v8: "test" },
		async open() {
			return {
				async write(bytes: Uint8Array) {
					payload = Buffer.concat([payload, Buffer.from(bytes)]);
					return bytes.byteLength;
				},
				close() {},
			};
		},
		async writeTextFile(_path: string, text: string) {
			candidate = JSON.parse(text) as typeof candidate;
		},
	};
	try {
		const capture = new Function("Deno", "probe", `return (async () => ${projectStateCaptureSource({
			candidates: ["probe"],
			payloadPath: join(root, "candidate.bin"),
			manifestPath: join(root, "candidate.json"),
			maxBytes: 8 * 1024 * 1024,
		})})()`);
		await capture(captureDeno, helper);
		assert.equal(getterCalls, 0);
		assert.deepEqual(candidate?.entries[0], {
			name: "probe",
			kind: "function",
			offset: 0,
			length: payload.length,
			usage: 'await helper("check")',
		});

		const entry = { ...candidate!.entries[0], hash: createHash("sha256").update(payload).digest("hex") };
		const previousProbe = Object.getOwnPropertyDescriptor(globalThis, "probe");
		const previousNotebook = Object.getOwnPropertyDescriptor(globalThis, "__piNotebook");
		try {
			Object.defineProperty(globalThis, "__piNotebook", { value: { syncProjectBindings() {} }, configurable: true });
			const restore = new Function("Deno", "crypto", `return (async () => ${projectStateRestoreSource({
				deno: "2.9.5",
				v8: "test",
				entries: [entry as never],
			}, join(root, "candidate.bin"))})()`);
			await restore({ version: { deno: "2.9.5", v8: "test" }, async readFile() { return payload; } }, { randomUUID });
			const restored = (globalThis as Record<string, unknown>)["probe"] as { usage?: string; description?: string };
			assert.equal(restored.usage, 'await helper("check")');
			assert.equal(restored.description, undefined);
		} finally {
			if (previousProbe) Object.defineProperty(globalThis, "probe", previousProbe);
			else delete (globalThis as Record<string, unknown>)["probe"];
			if (previousNotebook) Object.defineProperty(globalThis, "__piNotebook", previousNotebook);
			else delete (globalThis as Record<string, unknown>)["__piNotebook"];
		}

		const details: NotebookStatusDetails = {
			state: "idle",
			userCells: 0,
			checkpoint: {},
			retainedBindings: 1,
			retainedBytes: payload.length,
			pinnedBindings: 1,
			pinned: [{ name: "probe", kind: "function", bytes: payload.length, updatedAt: new Date().toISOString(), pinned: true, usage: 'await helper("check")' }],
			omittedPinned: 0,
			largestUnpinned: [],
			omittedLargestUnpinned: 0,
		};
		assert.match(formatStatus(details), /probe: .*usage: await helper\("check"\)/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
