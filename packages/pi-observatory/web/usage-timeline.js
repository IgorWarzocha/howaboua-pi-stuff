// @ts-check
import { createSkillSelection } from "./skill-selection.js";
import { dailyTimeline, timelineChart } from "./timeline-chart.js";
import { element } from "./view-dom.js";

/** @typedef {import('../src/usage-query.ts').UsageRow} UsageRow */

/** @param {(day: string) => void} selectDay */
export function createUsageTimeline(selectDay) {
	const target = element("usage-history");
	const controls = element("skill-comparison-controls");
	const activity = element("skill-activity");
	const selectionActions = element("skill-selection-actions");
	const skillsSelected = createSkillSelection(draw);
	/** @type {{rows: UsageRow[], skills: boolean, empty: string} | undefined} */
	let latest;
	let width = 0;

	function draw() {
		if (!latest || target.contains(document.activeElement)) return;
		const { rows, skills, empty } = latest;
		const selection = skills ? skillsSelected.selection() : [];
		const actor = activity.querySelector('input[value="user"]:checked')
			? "user"
			: "agent";
		/** @type {import('./timeline-chart.js').TimelineSeries[]} */
		const series = skills
			? selection.map(({ key, label, slot }) => ({
					key,
					label,
					plotted: true,
					className: `skill-line skill-line-${slot}`,
				}))
			: [
					{
						key: "user",
						label: "User",
						plotted: true,
						className: "usage-user",
					},
				];
		/** @type {Map<string, {day: string, values: Record<string, number>}>} */
		const byDay = new Map();
		for (const { row, key } of skills
			? selection
			: rows.map((row) => ({ row, key: "user" }))) {
			for (const day of row.daily) {
				const count = day[skills ? actor : "user"];
				if (!count) continue;
				let total = byDay.get(day.day);
				if (!total) {
					total = { day: day.day, values: {} };
					byDay.set(day.day, total);
				}
				total.values[key] = (total.values[key] ?? 0) + count;
			}
		}
		const days = dailyTimeline([...byDay.values()]);
		target.replaceChildren(
			timelineChart(days, target.clientWidth, {
				id: "usage-history",
				title: skills
					? actor === "agent"
						? "Skill reads"
						: "Skill submissions"
					: "Command activity",
				description: skills
					? `Daily ${actor === "agent" ? "agent reads" : "user submissions"} per selected skill. Use arrow keys to select a day, then select a count to filter the table to that day.`
					: "Daily command submissions. Use arrow keys to select a day, then select a count to filter the table.",
				empty: !rows.length
					? empty
					: skills && !selection.length
						? "Tick skills in the table to compare."
						: "No recorded activity in this selection.",
				series,
				select: selectDay,
				actionLabel: "View day",
			}),
		);
	}
	const resize = new ResizeObserver(([entry]) => {
		const next = Math.floor(entry?.contentRect.width ?? 0);
		if (width === next) return;
		width = next;
		draw();
	});
	resize.observe(target);
	/** @param {FocusEvent} event */
	const onFocusOut = (event) => {
		if (
			event.relatedTarget instanceof Node &&
			target.contains(event.relatedTarget)
		)
			return;
		queueMicrotask(draw);
	};
	target.addEventListener("focusout", onFocusOut);
	activity.addEventListener("change", draw);
	return {
		checkbox: skillsSelected.checkbox,
		/** @param {UsageRow[]} rows @param {boolean} skills @param {string} empty */
		render(rows, skills, empty) {
			latest = { rows, skills, empty };
			controls.hidden = !skills;
			selectionActions.hidden = !skills;
			if (skills) skillsSelected.render(rows);
			draw();
		},
		dispose() {
			resize.disconnect();
			target.removeEventListener("focusout", onFocusOut);
			activity.removeEventListener("change", draw);
			latest = undefined;
		},
	};
}
