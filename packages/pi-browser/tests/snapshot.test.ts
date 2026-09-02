import assert from "node:assert/strict";
import test from "node:test";
import { snapshotData } from "../src/cdp/snapshot.js";
import { assertHttpUrl } from "../src/cdp/url.js";
import { FakeCdp } from "./fake-cdp.js";

test("snapshots emit compact lines and current interactive references", async () => {
	assert.doesNotThrow(() => assertHttpUrl("https://example.com"));
	assert.throws(() => assertHttpUrl("file:///etc/passwd"), /Only http\/https/);
	let snapshotNumber = 0;
	const cdp = new FakeCdp(({ method }) => {
		if (method === "Accessibility.getFullAXTree") {
			snapshotNumber++;
			return {
				nodes: [
					{
						nodeId: "root",
						role: { value: "RootWebArea" },
						name: { value: "" },
						childIds: ["button", "menu", "text"],
					},
					{
						nodeId: "button",
						parentId: "root",
						backendDOMNodeId: 40 + snapshotNumber,
						role: { value: "button" },
						name: { value: "Continue" },
					},
					{
						nodeId: "menu",
						parentId: "root",
						backendDOMNodeId: 80 + snapshotNumber,
						role: { value: "menuitemcheckbox" },
						name: { value: "Show archived" },
					},
					{
						nodeId: "text",
						parentId: "root",
						role: { value: "StaticText" },
						name: { value: "Hello   world" },
					},
				],
			};
		}
		if (method === "Runtime.evaluate") {
			return {
				result: {
					value: {
						title: "Page",
						url: "https://example.com",
					},
				},
			};
		}
		return {};
	});
	const refs = new Map<number, number>();
	const result = await snapshotData(cdp, "session", refs, {
		refId: "ABCDEF12",
		responseLength: "short",
	});
	assert.deepEqual(result.content, [
		{ line: 1, text: "[1] button Continue", element_id: 1 },
		{
			line: 2,
			text: "[2] menuitemcheckbox Show archived",
			element_id: 2,
		},
		{ line: 3, text: "Hello world" },
	]);
	assert.equal(refs.get(1), 41);
	const next = await snapshotData(cdp, "session", refs, {
		responseLength: "short",
	});
	assert.deepEqual(
		next.elements.map((element) => element.id),
		[3, 4],
	);
	assert.equal(refs.has(1), false);
	assert.equal(refs.get(3), 42);
});
