import type { Theme } from "@earendil-works/pi-coding-agent";
import { MouseRegion, visibleWidth } from "@earendil-works/pi-tui";
import { REACTIONS, REACTION_KEYS, type Reaction } from "./reactions.js";

export function reactionRow(
	theme: Theme,
	selected: () => Reaction | undefined,
	toggle: (reaction: Reaction) => boolean,
) {
	let cells: { row: number; start: number; end: number; reaction: Reaction }[] =
		[];
	return new MouseRegion(
		{
			render(width) {
				cells = [];
				const lines: string[] = [];
				let line = "";
				let column = 0;
				const active = selected();
				for (const reaction of REACTION_KEYS) {
					const icon = REACTIONS[reaction].icon;
					const size = visibleWidth(icon) + 2;
					if (size > width) continue;
					if (column + size > width) {
						lines.push(line);
						line = "";
						column = 0;
					}
					const button = ` ${icon} `;
					line += active === reaction ? theme.bg("selectedBg", button) : button;
					cells.push({
						row: lines.length,
						start: column,
						end: column + size,
						reaction,
					});
					column += size;
				}
				if (line) lines.push(line);
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
			return hit && toggle(hit.reaction) ? { handled: true } : undefined;
		},
	);
}
