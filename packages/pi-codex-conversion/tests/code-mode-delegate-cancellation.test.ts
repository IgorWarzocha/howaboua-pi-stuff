import assert from "node:assert/strict";
import test from "node:test";
import { CodeModeDelegateRuntime } from "../src/tools/code-mode/delegate-runtime.ts";

test("cell cancellation reaches its active nested tools", async () => {
	const runtime = new CodeModeDelegateRuntime(() => undefined);
	let started!: () => void;
	const active = new Promise<void>((resolve) => { started = resolve; });
	runtime.bindCell("cell-a", { cwd: process.cwd() }, new Map([[
		"blocking",
		{
			name: "blocking",
			usage: "blocking({})",
			deferLoading: false,
			kind: "function",
			async invoke(_input, _context, signal) {
				started();
				await new Promise<void>((_resolve, reject) => signal.addEventListener(
					"abort",
					() => reject(new Error("nested tool cancelled")),
					{ once: true },
				));
			},
		},
	]]));
	const pending = runtime.invokeDirect("cell-a", 1, "blocking", {});
	await active;
	runtime.cancelCell("cell-a");
	await assert.rejects(pending, /nested tool cancelled/);
});
