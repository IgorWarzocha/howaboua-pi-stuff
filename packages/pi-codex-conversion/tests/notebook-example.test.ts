import assert from "node:assert/strict";
import test from "node:test";
import { notebookExampleSource } from "../src/tools/notebook-mode/kernel-runtime.ts";

test("Notebook seeds expose a self-describing foo/bar example and skip conflicts", async () => {
	const previousFoo = Object.getOwnPropertyDescriptor(globalThis, "foo");
	const previousBar = Object.getOwnPropertyDescriptor(globalThis, "bar");
	const restore = (name: "foo" | "bar", descriptor: PropertyDescriptor | undefined) => {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else delete (globalThis as Record<string, unknown>)[name];
	};
	try {
		delete (globalThis as Record<string, unknown>)["foo"];
		delete (globalThis as Record<string, unknown>)["bar"];
		let output = "";
		const run = new Function("console", `return (async () => ${notebookExampleSource("EXAMPLE")})()`);
		await run({ log(value: string) { output += value; } });
		const foo = (globalThis as Record<string, unknown>)["foo"] as { description: string; usage: string }[] & { description: string; usage: string };
		const bar = (globalThis as Record<string, unknown>)["bar"] as { description: string; usage: string } & ((item: unknown) => unknown);
		assert.equal(foo.description, "Example records for reusable helper patterns");
		assert.match(foo.usage, /^Inspect:/);
		assert.equal(bar.description, "Summarize one foo item without mutating foo");
		assert.match(bar.usage, /Run: bar\(foo\[index\]\)/);
		assert.deepEqual(bar(foo[0]), { id: "alpha", value: "first example record" });
		assert.equal(output, 'EXAMPLE["foo","bar"]');

		delete (globalThis as Record<string, unknown>)["foo"];
		delete (globalThis as Record<string, unknown>)["bar"];
		output = "";
		const runOccupied = new Function("console", `return (async () => ${notebookExampleSource("EXAMPLE", true)})()`);
		await runOccupied({ log(value: string) { output += value; } });
		assert.equal((globalThis as Record<string, unknown>)["foo"], undefined);
		assert.equal((globalThis as Record<string, unknown>)["bar"], undefined);
		assert.equal(output, "EXAMPLE[]");
	} finally {
		restore("foo", previousFoo);
		restore("bar", previousBar);
	}
});
