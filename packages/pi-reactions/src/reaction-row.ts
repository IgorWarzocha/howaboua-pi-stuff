import type { Theme } from "@earendil-works/pi-coding-agent";
import { MouseRegion, visibleWidth } from "@earendil-works/pi-tui";
import type { Reaction } from "./config.js";

const PICKER_ICON = "🫥";

export function reactionRow(
	theme: Theme,
	outputPad: number,
	reactions: readonly Reaction[],
	selected: () => Reaction | undefined,
	toggle: (reactionId: string) => boolean,
) {
	let expanded = false;
	let cells: {
		row: number;
		start: number;
		end: number;
		reactionId: string | undefined;
	}[] = [];
	return new MouseRegion(
		{
			render(width) {
				cells = [];
				const lines: string[] = [];
				const inset = width > 5 ? outputPad : 0;
				const edge = width - inset;
				const margin = " ".repeat(inset);
				let line = margin;
				let column = inset;
				const active = selected();
				const buttons = expanded ? [undefined, ...reactions] : [undefined];
				for (const reaction of buttons) {
					const icon =
						reaction?.icon ??
						(expanded ? PICKER_ICON : (active?.icon ?? PICKER_ICON));
					const iconWidth = visibleWidth(icon);
					if (iconWidth > edge - inset) continue;
					const pad = iconWidth + 2 <= edge - inset ? " " : "";
					const size = iconWidth + pad.length * 2;
					let gap = column > inset ? " " : "";
					if (column + gap.length + size > edge) {
						lines.push(line);
						line = margin;
						column = inset;
						gap = "";
					}
					const highlighted = reaction
						? reaction.id === active?.id
						: expanded || active !== undefined;
					const background = highlighted ? "selectedBg" : "customMessageBg";
					line += gap + theme.bg(background, pad + icon + pad);
					column += gap.length;
					cells.push({
						row: lines.length,
						start: column,
						end: column + size,
						reactionId: reaction?.id,
					});
					column += size;
				}
				if (cells.length) lines.push(line);
				return lines;
			},
			invalidate() {},
		},
		(event) => {
			if (
				event.type !== "click" ||
				event.button !== "left" ||
				event.shift ||
				event.alt ||
				event.ctrl
			)
				return undefined;
			const hit = cells.find(
				(cell) =>
					event.y === cell.row && event.x >= cell.start && event.x < cell.end,
			);
			if (!hit) return undefined;
			if (hit.reactionId === undefined) {
				expanded = !expanded;
				return { handled: true };
			}
			if (!toggle(hit.reactionId)) return undefined;
			expanded = false;
			return { handled: true };
		},
	);
}
