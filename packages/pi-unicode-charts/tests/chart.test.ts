import { expect, test } from "bun:test";
import {
	parseChartSource,
	renderChart,
	transformChartMarkdown,
} from "../src/chart.js";

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
		"```ts",
		"const value = 1;",
		"```",
	].join("\n");

	const transformed = transformChartMarkdown(source, 48);

	expect(transformed).toContain("┤");
	expect(transformed).toContain("█");
	expect(transformed).toContain("```ts");
	expect(transformed).toContain("const value = 1;");
	expect(transformed).not.toContain("type: bar");
});

test("keeps invalid and unfinished chart fences as source", () => {
	const invalid = "```chart\ntype: pie\ndata:\nA 1\n```";
	const unfinished = "```chart\ntype: line\ndata:\nA 1";

	expect(transformChartMarkdown(invalid, 48)).toBe(invalid);
	expect(transformChartMarkdown(unfinished, 48)).toBe(unfinished);
});

test("keeps rendered chart rows within the requested width", () => {
	const cases = [
		parseChartSource("type: line\ndata:\nA 2\nB 9\nC 4"),
		parseChartSource("type: scatter\ndata:\nA 2\nB 9\nC 4"),
		parseChartSource("type: sparkline\ndata:\n2 9 4 8 3"),
		parseChartSource("type: heatmap\ndata:\nA 1 2 3\nB 3 2 1"),
	].filter((spec) => spec !== undefined);

	for (const spec of cases) {
		const rendered = renderChart(spec, 40);
		expect(rendered.length).toBeGreaterThan(0);
		expect(rendered.every((line) => Array.from(line).length <= 40)).toBe(true);
	}

	const line = renderChart(cases[0]!, 40).join("\n");
	expect(/[\u2800-\u28ff]/u.test(line)).toBe(true);

	const sparkline = renderChart(cases[2]!, 40)[0] ?? "";
	expect(sparkline.length).toBe(40);

	const heatmap = renderChart(cases[3]!, 40)[0] ?? "";
	expect(heatmap.length).toBe(40);
});
