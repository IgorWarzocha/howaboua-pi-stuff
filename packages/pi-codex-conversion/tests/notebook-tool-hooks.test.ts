import assert from "node:assert/strict";
import test from "node:test";
import { notebookBootstrapSource, notebookToolHooksSource } from "../src/tools/notebook-mode/kernel-runtime.ts";

test("Notebook hooks await tool settlement without recursion, cross-call suppression, or result mutation", async () => {
	type Event = { type: string; toolName: string; input: { value?: number }; status: string; result?: { value: number }; error?: string };
	const events: Event[] = [];
	const calls: string[] = [];
	const output: string[] = [];
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const abandoned = Promise.withResolvers<void>();
	const later = Promise.withResolvers<void>();
	let lateCall: Promise<unknown> | undefined;
	const sandbox = {
		async fetch(_url: string, options: RequestInit) {
			const request = JSON.parse(String(options.body));
			if (request.kind === "cancel_tools") abandoned.resolve();
			if (request.kind === "emit") {
				await new Promise((resolve) => setTimeout(resolve, 10));
				output.push(...request.items.map((item: { text: string }) => item.text));
			}
			if (request.kind !== "tool") return Response.json({ ok: true });
			calls.push(request.toolName.name);
			if (request.toolName.name === "abandoned") await abandoned.promise;
			return request.toolName.name === "fails"
				? Response.json({ ok: false, error: "original tool error" })
				: Response.json({ ok: true, result: { value: request.input.value ?? 1 } });
		},
		tools: {} as Record<string, (input: unknown) => Promise<unknown>>,
		text: undefined as unknown as (value: unknown) => void,
		__piNotebook: undefined as unknown as {
			begin(id: string, tools: unknown[], names: object): Promise<void>;
			finish(id: string): Promise<void>;
			end(id: string): void;
		},
	};
	const boot = new Function("globalThis", "Deno", "setInterval", "clearInterval", `return (async () => ${notebookBootstrapSource("http://bridge", "token", "exit", "/project")})()`);
	await boot(sandbox, { chdir() {}, ppid: 1, memoryUsage: () => ({ heapUsed: 1, heapTotal: 2, rss: 3, external: 4 }) }, () => 0, () => {});
	const handler = async (event: Event) => {
		events.push(structuredClone(event));
		if (event.toolName === "first") {
			entered.resolve();
			await release.promise;
			await sandbox.tools["followup"]!({});
			lateCall = later.promise.then(() => sandbox.tools["followup"]!({}));
			void lateCall.catch(() => undefined);
		}
		if (event.toolName === "fails") throw new Error("handler failure");
		if (event.toolName === "abandoned") sandbox.text("hook output drained");
		if (event.result) event.result.value = 999;
	};
	const configure = (enabled: boolean) => new Function("globalThis", "event", notebookToolHooksSource(["event"], enabled))(sandbox, handler);
	await sandbox.__piNotebook.begin("cell-1", [], {});
	try {
		await sandbox.tools["passive"]!({});
		assert.equal(events.length, 0);
		configure(true);
		const input = { value: 7 };
		let firstSettled = false;
		const first = sandbox.tools["first"]!(input).then((value) => { firstSettled = true; return value; });
		input.value = 8;
		await entered.promise;
		assert.equal(firstSettled, false);
		assert.deepEqual(await sandbox.tools["parallel"]!({ value: 2 }), { value: 2 });
		assert.deepEqual(events.map(({ toolName }) => toolName), ["first", "parallel"]);
		release.resolve();
		assert.deepEqual(await first, { value: 7 });
		assert.equal(events[0]?.input.value, 7);
		assert.ok(calls.includes("followup"));
		assert.equal(events.length, 2);
		await assert.rejects(sandbox.tools["fails"]!({}), /original tool error/);
		assert.deepEqual(events.at(-1), { type: "tool_result", toolName: "fails", input: {}, status: "error", error: "original tool error" });

		void sandbox.tools["abandoned"]!({});
		await sandbox.__piNotebook.finish("cell-1");
		assert.ok(output.includes("hook output drained"));
		assert.ok(output.some((line) => line.includes("handler failure")));
		configure(false);
		await sandbox.__piNotebook.begin("cell-2", [], {});
		const stale = assert.rejects(lateCall!, /outside its originating exec cell/);
		later.resolve();
		await stale;
		const count = events.length;
		await sandbox.tools["disabled"]!({});
		assert.equal(events.length, count);
		await sandbox.__piNotebook.finish("cell-2");
	} finally {
		release.resolve();
		abandoned.resolve();
		later.resolve();
		sandbox.__piNotebook.end("cell-1");
		sandbox.__piNotebook.end("cell-2");
	}
});
