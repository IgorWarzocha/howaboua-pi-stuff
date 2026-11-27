import type { Theme } from "@earendil-works/pi-coding-agent";
import { MouseRegion, visibleWidth } from "@earendil-works/pi-tui";
import { REACTIONS, REACTION_KEYS, type Reaction } from "./reactions.js";

type Button = "picker" | Reaction;
const PICKER_ICON = "☺";

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
				let line = " ".repeat(inset);
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
					const pad = iconWidth + 2 <= edge - inset ? " " : "";
					const size = iconWidth + pad.length * 2;
					if (column + size > edge) {
						lines.push(line);
						line = " ".repeat(inset);
						column = inset;
					}
					const face = pad + icon + pad;
					const highlighted =
						button === active ||
						(button === "picker" && (expanded || active !== undefined));
					line += highlighted ? theme.bg("selectedBg", face) : face;
					cells.push({
						row: lines.length,
						start: column,
						end: column + size,
						button,
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
					cell.row === event.y && event.x >= cell.start && event.x < cell.end,
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
