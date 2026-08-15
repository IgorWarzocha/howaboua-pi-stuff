import { expect, test } from "bun:test";
import { parseChartSource, transformChartMarkdown } from "../src/chart.js";

test("parses chart rows with labels containing spaces", () => {
	const spec = parseChartSource(`
		type: bar
		title: Requests
		data:
		GET /users 120
		POST /users | 80
	`);

	expect(spec).toEqual({
		type: "bar",
		title: "Requests",
		points: [
			{ label: "GET /users", value: 120 },
			{ label: "POST /users", value: 80 },
		],
	});
});

test("replaces closed chart fences and preserves other Markdown", () => {
	const source = [
		"Before",
		"",
		"```chart",
		"type: bar",
		"data:",
		"A 10",
		"B 5",
		"```",
		"",
		"````md",
		"```chart",
		"type: scatter",
		"data:",
		"Example 1",
		"```",
		"````",
	].join("\n");

	const transformed = transformChartMarkdown(source, 48);

	expect(transformed).toContain("┤");
	expect(transformed).toContain("█");
	expect(transformed).toContain("```chart");
	expect(transformed).toContain("type: scatter");
	expect(transformed).not.toContain("type: bar");
});

test("keeps invalid and unfinished chart fences as source", () => {
	const invalid = "```chart\r\ntype: pie\r\ndata:\r\nA 1\r\n```";
	const unfinished = "```chart\ntype: line\ndata:\nA 1";

	expect(transformChartMarkdown(invalid, 48)).toBe(invalid);
	expect(transformChartMarkdown(unfinished, 48)).toBe(unfinished);
});
