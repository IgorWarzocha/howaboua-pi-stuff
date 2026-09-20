import assert from "node:assert/strict";
import test from "node:test";
import {
	formatLocalResult,
	parseRequest,
	planHostRoute,
	pruneResultCache,
	readCachedResult,
	runProgram,
} from "./browser.mjs";

test("parser canonicalizes operation batches and rejects ambiguous targets", () => {
	assert.deepEqual(parseRequest(JSON.stringify({
		response_length: "short",
		tabs: [{ query: "linkedin" }],
		open: [{ ref_id: "ABCDEF12" }],
		click: [{ ref_id: "ABCDEF12", id: 7 }],
		raw: [{ ref_id: "ABCDEF12", method: "DOM.getDocument" }],
	})), {
		operations: [
			{ action: "tabs", query: "linkedin", offset: 0 },
			{ action: "open", ref_id: "ABCDEF12", lineno: 1, response_length: "short" },
			{ action: "click", ref_id: "ABCDEF12", id: 7 },
			{ action: "raw", ref_id: "ABCDEF12", method: "DOM.getDocument", params: {} },
		],
	});
	assert.throws(
		() => parseRequest('{"open":[{"ref_id":"ABCDEF12","url":"https://example.com"}]}'),
		/exactly one/,
	);
});

test("host routing mirrors local host and strips transport fields", () => {
	const request = {
		host: "workstation",
		operations: [{ action: "tabs", offset: 0 }],
	};
	assert.deepEqual(planHostRoute(request, "other-host"), {
		host: "workstation",
		remote: true,
		request: { operations: [{ action: "tabs", offset: 0 }] },
	});
	assert.deepEqual(planHostRoute(request, "workstation.local"), {
		host: "workstation",
		remote: false,
		request: { operations: [{ action: "tabs", offset: 0 }] },
	});
});

test("child output is bounded before result formatting", async () => {
	await assert.rejects(
		runProgram(process.execPath, ["-e", "process.stdout.write('x'.repeat(9 * 1024 * 1024))"]),
		/output exceeded 8 MiB/,
	);
});

test("tabs are structured, filterable, and byte-bounded", async () => {
	const tabs = Array.from({ length: 500 }, (_, index) => ({
		ref_id: `T${String(index).padStart(7, "0")}`,
		title: index % 2 ? "Other" : "LinkedIn",
		url: `https://example.com/${"x".repeat(100)}`,
	}));
	const listed = await formatLocalResult(
		{ action: "tabs", query: "linkedin", offset: 0 },
		JSON.stringify(tabs),
	);
	assert.ok(listed.tabs.every(tab => tab.title === "LinkedIn"));
	assert.equal(listed.truncated, true);
	assert.equal(listed.next_offset, listed.tabs.length);
	assert.ok(Buffer.byteLength(JSON.stringify(listed)) < 50_000);
});

test("opened pages use line content and numbered element refs within the tool ceiling", async () => {
	const content = Array.from({ length: 300 }, (_, index) => ({
		line: index + 1,
		text: `${index} ${"content ".repeat(40)}`,
		...(index % 3 === 0 ? { element_id: index + 1 } : {}),
	}));
	const elements = content
		.filter(line => line.element_id)
		.map(line => ({ id: line.element_id, role: "link", name: `Link ${line.element_id}` }));
	const opened = await formatLocalResult(
		{ action: "open", ref_id: "ABCDEF12" },
		JSON.stringify({ ref_id: "ABCDEF12", title: "Example", url: "https://example.com", lineno: 1, content, elements }),
	);
	assert.equal(opened.ref_id, "ABCDEF12");
	assert.equal(opened.truncated, true);
	assert.equal(opened.next_lineno, opened.content.length + 1);
	assert.ok(opened.elements.length > 0);
	assert.ok(Buffer.byteLength(JSON.stringify(opened)) < 50_000);
});

test("escaped Unicode output is byte-safe, recoverable, and removed after completion", async () => {
	const source = '🤣"\\\n'.repeat(20_000);
	const first = await formatLocalResult(
		{ action: "evaluate", ref_id: "ABCDEF12" },
		source,
	);
	assert.equal(first.truncated, true);
	assert.ok(Buffer.byteLength(JSON.stringify(first)) < 50_000);
	let recovered = first.value;
	let offset = first.next_offset;
	let complete = false;
	while (!complete) {
		const part = await readCachedResult({ handle: first.result_handle, offset });
		recovered += part.text;
		complete = part.complete;
		offset = part.next_offset;
		assert.ok(Buffer.byteLength(JSON.stringify(part)) < 50_000);
	}
	assert.equal(recovered, source);
	await assert.rejects(
		readCachedResult({ handle: first.result_handle, offset: 0 }),
		/result handle not found/,
	);
});

test("abandoned cached results expire", async () => {
	const first = await formatLocalResult(
		{ action: "html", ref_id: "ABCDEF12" },
		"x".repeat(100_000),
	);
	assert.equal(first.truncated, true);
	assert.equal(await pruneResultCache(Date.now() + 2 * 60 * 60 * 1000) > 0, true);
	await assert.rejects(
		readCachedResult({ handle: first.result_handle, offset: first.next_offset }),
		/result handle not found/,
	);
});
