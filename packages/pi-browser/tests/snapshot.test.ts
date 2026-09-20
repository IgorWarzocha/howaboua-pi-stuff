import assert from "node:assert/strict";
import test from "node:test";
import { snapshotData } from "../src/cdp/snapshot.js";
import { FakeCdp } from "./fake-cdp.js";

test("snapshots emit compact lines and current interactive references", async () => {
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
						childIds: ["button", "menu", "checkbox", "text"],
					},
					{
						nodeId: "button",
						parentId: "root",
						backendDOMNodeId: 40 + snapshotNumber,
						role: { value: "button" },
						name: { value: "Continue" },
						properties: [
							{ name: "expanded", value: { value: false } },
							{ name: "disabled", value: { value: true } },
						],
					},
					{
						nodeId: "menu",
						parentId: "root",
						backendDOMNodeId: 80 + snapshotNumber,
						role: { value: "menuitemcheckbox" },
						name: { value: "" },
						properties: [
							{ name: "checked", value: { value: "mixed" } },
							{ name: "selected", value: { value: false } },
						],
					},
					{
						nodeId: "checkbox",
						parentId: "root",
						backendDOMNodeId: 120 + snapshotNumber,
						role: { value: "checkbox" },
						name: { value: "Agree" },
						properties: [
							{
								name: "checked",
								value: { type: "tristate", value: "false" },
							},
						],
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
		{
			line: 1,
			text: "[1] button Continue [expanded=false, disabled=true]",
			element_id: 1,
		},
		{
			line: 2,
			text: "[2] menuitemcheckbox [checked=mixed, selected=false]",
			element_id: 2,
		},
		{
			line: 3,
			text: "[3] checkbox Agree [checked=false]",
			element_id: 3,
		},
		{ line: 4, text: "Hello world" },
	]);
	assert.equal(refs.get(1), 41);
	const next = await snapshotData(cdp, "session", refs, {
		responseLength: "short",
	});
	assert.deepEqual(
		next.elements.map((element) => element.id),
		[4, 5, 6],
	);
	assert.equal(refs.has(1), false);
	assert.equal(refs.get(4), 42);
});
