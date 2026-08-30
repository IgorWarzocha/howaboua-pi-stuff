import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { limitedText, readCachedResult } from "../src/browser/artifacts.js";
import { boundSnapshot, boundTabs } from "../src/browser/bounds.js";

test("tab and page results remain bounded with visible continuations", () => {
	const pages = Array.from({ length: 500 }, (_, index) => ({
		targetId: `T${String(index).padStart(7, "0")}`,
		title: index % 2 ? "Other" : "LinkedIn",
		url: `https://example.com/${"x".repeat(100)}`,
		type: "page",
	}));
	const tabs = boundTabs(pages, "linkedin", 0);
	assert.equal(tabs["truncated"], true);
	assert.ok(Buffer.byteLength(JSON.stringify(tabs)) < 50_000);
	const content = Array.from({ length: 300 }, (_, index) => ({
		line: index + 1,
		text: `${index} ${"content ".repeat(40)}`,
		...(index % 3 === 0 ? { element_id: index + 1 } : {}),
	}));
	const page = boundSnapshot({
		ref_id: "ABCDEF12",
		title: "Example",
		url: "https://example.com",
		lineno: 1,
		content,
		elements: content.flatMap((line) =>
			line.element_id === undefined
				? []
				: [
						{
							id: line.element_id,
							role: "link",
							name: `Link ${line.element_id}`,
						},
					],
		),
	});
	assert.equal(page["truncated"], true);
	assert.ok(Buffer.byteLength(JSON.stringify(page)) < 50_000);
	assert.ok(Array.isArray(page["elements"]) && page["elements"].length > 0);
});

test("large escaped text is recoverable and removed after completion", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-browser-results-"));
	const previous = process.env["XDG_RUNTIME_DIR"];
	process.env["XDG_RUNTIME_DIR"] = directory;
	try {
		const source = '🤣"\\\\\\n'.repeat(20_000);
		const first = await limitedText({ ref_id: "ABCDEF12" }, "value", source);
		assert.equal(first["truncated"], true);
		let recovered = String(first["value"]);
		let offset = Number(first["next_offset"]);
		let complete = false;
		while (!complete) {
			const part = await readCachedResult({
				handle: String(first["result_handle"]),
				offset,
			});
			recovered += String(part["text"]);
			complete = part["complete"] === true;
			offset = Number(part["next_offset"]);
		}
		assert.equal(recovered, source);
		await assert.rejects(
			readCachedResult({
				handle: String(first["result_handle"]),
				offset: 0,
			}),
			/result handle not found/,
		);
	} finally {
		if (previous === undefined) {
			delete process.env["XDG_RUNTIME_DIR"];
		} else {
			process.env["XDG_RUNTIME_DIR"] = previous;
		}
		await rm(directory, { recursive: true, force: true });
	}
});
