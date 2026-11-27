import type { Theme } from "@earendil-works/pi-coding-agent";
import { MouseRegion, visibleWidth } from "@earendil-works/pi-tui";
import { REACTIONS, REACTION_KEYS, type Reaction } from "./reactions.js";

type Button = "picker" | Reaction;
const PICKER_ICON = "🙂";
const BUTTON_HEIGHT = 3;

export function reactionRow(
	theme: Theme,
	outputPad: number,
	selected: () => Reaction | undefined,
	toggle: (reaction: Reaction) => boolean,
) {
	let expanded = false;
	let cells: { row: number; start: number; end: number; button: Button }[] = [];
	return new MouseRegion(
		{
			render(width) {
				cells = [];
				const lines: string[] = [];
				const inset = width > 5 ? outputPad : 0;
				const edge = width - inset;
				const margin = " ".repeat(inset);
				let top = margin;
				let middle = margin;
				let column = inset;
				const active = selected();
				const buttons: readonly Button[] = expanded
					? ["picker", ...REACTION_KEYS]
					: ["picker"];
				for (const button of buttons) {
					const icon =
						button === "picker"
							? !expanded && active
								? REACTIONS[active].icon
								: PICKER_ICON
							: REACTIONS[button].icon;
					const iconWidth = visibleWidth(icon);
					if (iconWidth > edge - inset) continue;
					const padding = Math.min(
						2,
						Math.floor((edge - inset - iconWidth) / 2),
					);
					const size = iconWidth + padding * 2;
					let gap = column > inset ? " " : "";
					if (column + gap.length + size > edge) {
						lines.push(top, middle, top);
						top = middle = margin;
						column = inset;
						gap = "";
					}
					const pad = " ".repeat(padding);
					const highlighted =
						button === active ||
						(button === "picker" && (expanded || active !== undefined));
					const background = highlighted ? "selectedBg" : "customMessageBg";
					top += gap + theme.bg(background, " ".repeat(size));
					middle += gap + theme.bg(background, pad + icon + pad);
					column += gap.length;
					cells.push({
						row: lines.length,
						start: column,
						end: column + size,
						button,
					});
					column += size;
				}
				if (cells.length) lines.push(top, middle, top);
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
					event.y >= cell.row &&
					event.y < cell.row + BUTTON_HEIGHT &&
					event.x >= cell.start &&
					event.x < cell.end,
			);
			if (!hit) return undefined;
			if (hit.button === "picker") {
				expanded = !expanded;
				return { handled: true };
			}
			if (!toggle(hit.button)) return undefined;
			expanded = false;
			return { handled: true };
		},
	);
}
