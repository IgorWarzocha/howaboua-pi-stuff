import { describe, expect, test } from "bun:test";
import {
	createCodeModeRenderTracker,
	type RenderTheme,
	renderCodeModeResult,
	renderExecCall,
	renderTrackedCodeModeResult,
	renderWaitCall,
} from "../src/rendering.js";

const theme: RenderTheme = {
	fg: (_role, text) => text,
	bold: (text) => text,
};

function renderText(component: { render(width: number): string[] }): string {
	return component
		.render(120)
		.map((line) => line.trimEnd())
		.join("\n");
}

describe("code-mode rendering", () => {
	test("summarizes composed tools without exposing the JSON envelope", () => {
		const tracker = createCodeModeRenderTracker();
		const context = { toolCallId: "exec-1", expanded: false };
		tracker.start("exec-1");
		expect(
			renderText(
				renderExecCall(
					{
						code: 'const [repo, text] = await Promise.all([tools.repo_snapshot("."), tools.text_metrics("hello")]);',
					},
					theme,
					context,
					tracker,
				),
			),
		).toBe("• Running code\n  └ repo_snapshot · text_metrics");

		tracker.finish("exec-1");
		expect(
			renderText(
				renderExecCall(
					{ code: "tools.repo_snapshot('.')" },
					theme,
					context,
					tracker,
				),
			),
		).toBe("• Ran code\n  └ repo_snapshot");

		tracker.finish("exec-1", "yielded");
		expect(
			renderText(
				renderExecCall(
					{ code: "tools.delayed_echo('2 ready')" },
					theme,
					context,
					tracker,
				),
			),
		).toBe("• Started code\n  └ delayed_echo");
	});

	test("shows output without the model-facing protocol status", () => {
		const rendered = renderCodeModeResult(
			{
				content: [
					{ type: "text", text: "Script completed" },
					{ type: "text", text: '{"files":9}' },
				],
				details: { cellId: "2", status: "result" },
			},
			{ expanded: false, isPartial: false },
			theme,
		);
		expect(renderText(rendered)).toBe('    {"files":9}');
	});

	test("renders wait and yielded-cell states", () => {
		const tracker = createCodeModeRenderTracker();
		const context = { toolCallId: "wait-1" };
		tracker.finish("wait-1");
		expect(
			renderText(renderWaitCall({ cell_id: "7" }, theme, context, tracker)),
		).toBe("• Waited for code cell #7");

		const result = renderCodeModeResult(
			{
				content: [{ type: "text", text: "Script running with cell ID 7" }],
				details: { cellId: "7", status: "yielded" },
			},
			{ expanded: false, isPartial: false },
			theme,
		);
		expect(renderText(result)).toBe("    Cell #7 still running");
	});

	test("restores completed call state when historical rows rerender", () => {
		const tracker = createCodeModeRenderTracker();
		const context = { toolCallId: "exec-history", expanded: false };
		renderTrackedCodeModeResult(
			{
				content: [{ type: "text", text: "Script running with cell ID 9" }],
				details: { cellId: "9", status: "yielded" },
			},
			{ expanded: false, isPartial: false },
			theme,
			context,
			tracker,
		);
		expect(
			renderText(
				renderExecCall(
					{ code: "tools.delayed_echo('2 ready')" },
					theme,
					context,
					tracker,
				),
			),
		).toBe("• Started code\n  └ delayed_echo");
	});
});
