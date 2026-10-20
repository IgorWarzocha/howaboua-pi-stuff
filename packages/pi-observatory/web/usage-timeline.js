// @ts-check
import { dailyTimeline, timelineChart } from "./timeline-chart.js";
import { element } from "./view-dom.js";

/** @typedef {import('../src/usage-query.ts').UsageRow} UsageRow */

/** @param {(day: string) => void} selectDay */
export function createUsageTimeline(selectDay) {
	const target = element("usage-history");
	/** @type {{rows: UsageRow[], skills: boolean, empty: string} | undefined} */
	let latest;
	let width = 0;

	function draw() {
		if (!latest || target.contains(document.activeElement)) return;
		const { rows, skills, empty } = latest;
		/** @type {Map<string, {day: string, values: Record<string, number>}>} */
		const byDay = new Map();
		for (const row of rows) {
			for (const day of row.daily) {
				if (!day.user && !(skills && day.agent)) continue;
				let total = byDay.get(day.day);
				if (!total) {
					total = { day: day.day, values: { agent: 0, user: 0 } };
					byDay.set(day.day, total);
				}
				total.values["agent"] = (total.values["agent"] ?? 0) + day.agent;
				total.values["user"] = (total.values["user"] ?? 0) + day.user;
			}
		}
		const days = dailyTimeline([...byDay.values()]);
		target.replaceChildren(
			timelineChart(days, target.clientWidth, {
				id: "usage-history",
				title: skills ? "Skill activity" : "Command activity",
				description: skills
					? "Daily agent skill reads and user skill submissions. Use arrow keys to select a day, then select a count to filter the table."
					: "Daily command submissions. Use arrow keys to select a day, then select a count to filter the table.",
				empty: rows.length ? "No recorded activity in this selection." : empty,
				series: [
					...(skills
						? [
								{
									key: "agent",
									label: "Agent",
									plotted: true,
									className: "usage-agent",
								},
							]
						: []),
					{
						key: "user",
						label: "User",
						plotted: true,
						className: "usage-user",
					},
				],
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
	return {
		/** @param {UsageRow[]} rows @param {boolean} skills @param {string} empty */
		render(rows, skills, empty) {
			latest = { rows, skills, empty };
			draw();
		},
		dispose() {
			resize.disconnect();
			target.removeEventListener("focusout", onFocusOut);
			latest = undefined;
		},
	};
}
