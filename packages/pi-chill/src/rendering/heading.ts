import { keyHint, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	MouseRegion,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { ActivityGroup } from "../activity/group.js";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type RenderTheme = Parameters<CallRenderer>[1];

export function renderResultFallback(
	result: Parameters<NonNullable<ToolRenderers["renderResult"]>>[0],
	expanded: boolean,
	theme: RenderTheme,
): Component {
	const output = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	if (!output) return new Container();
	// Pi's generic fallback is private. Match its logical-line preview boundary
	// with public Text and keyHint, leaving width wrapping to Text as native does.
	const lines = output.split("\n");
	const visible = expanded ? lines : lines.slice(0, 10);
	const remaining = lines.length - visible.length;
	let text = visible.map((line) => theme.fg("toolOutput", line)).join("\n");
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	}
	return new Text(text, 0, 0);
}

export function renderActivityHeading(
	group: ActivityGroup,
	theme: RenderTheme,
	outputPad = 1,
): Component {
	const container = new (class extends Container {
		private cached: { width: number; lines: string[] } | undefined;

		override invalidate(): void {
			this.cached = undefined;
			super.invalidate();
		}

		override render(width: number): string[] {
			if (this.cached?.width !== width) {
				this.cached = { width, lines: super.render(width) };
			}
			return this.cached.lines;
		}
	})();
	container.addChild(
		new MouseRegion(
			{
				invalidate() {},
				render: (width) =>
					new Text(
						theme.fg(
							group.warning ? "warning" : "muted",
							truncateToWidth(
								`${group.open ? "▾" : "▸"} ${group.label()}`,
								Math.max(0, width - outputPad * 2),
							),
						),
						outputPad,
						0,
					).render(width),
			},
			(event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				group.open = !group.open;
				group.refresh();
				return { handled: true };
			},
		),
	);
	// Fit at render time: the terminal can resize without a new activity event.
	container.addChild({
		invalidate() {},
		render: (width) => {
			const indent = " ".repeat(outputPad + 3);
			const format = (label: string) =>
				theme.fg(
					label.startsWith("Failed ") || label.startsWith("Needs attention ")
						? "warning"
						: "muted",
					label,
				);
			const detail =
				group.endedAt === undefined
					? group.stage.label(Math.max(0, width - indent.length), format)
					: group.stage.summary(Math.max(0, width - indent.length), format);
			return detail
				? [truncateToWidth(theme.fg("muted", `${indent}${detail}`), width)]
				: [];
		},
	});
	return container;
}
