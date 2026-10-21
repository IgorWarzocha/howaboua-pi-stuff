// @ts-check
import { dailyTimeline, timelineChart } from "./timeline-chart.js";
import { OUTCOMES } from "./view-dom.js";

/** @typedef {import('../src/contracts.ts').Counts & { day: string }} Day */

/** @param {Day[]} rows @returns {Day[]} */
export function dailySeries(rows) {
	return dailyTimeline(rows.map(({ day, ...values }) => ({ day, values }))).map(
		({ day, values }) => ({
			day,
			calls: values["calls"] ?? 0,
			ok: values["ok"] ?? 0,
			error: values["error"] ?? 0,
			nonzero: values["nonzero"] ?? 0,
			incomplete: values["incomplete"] ?? 0,
			unknown: values["unknown"] ?? 0,
		}),
	);
}

/** @param {import('./timeline-chart.js').TimelineDay} day */
function errorRate(day) {
	const { ok = 0, error = 0, nonzero = 0 } = day.values;
	const completed = ok + error + nonzero;
	const percentage = completed ? (error / completed) * 100 : 0;
	return !completed
		? "—"
		: percentage > 0 && percentage < 0.1
			? "<0.1%"
			: `${percentage.toFixed(1)}%`;
}

/** @param {Day[]} days @param {number} width @param {(day: string, outcome: import('../src/contracts.ts').Outcome | "all") => void} select */
export function activityChart(days, width, select) {
	const series = /** @type {const} */ ([["calls", "Total calls"], ...OUTCOMES]);
	return timelineChart(
		days.map(({ day, ...values }) => ({ day, values })),
		width,
		{
			id: "activity",
			title: "Activity",
			description: `Daily errors, nonzero exits, missing and unclassified results, ${days[0]?.day} to ${days.at(-1)?.day}. Use arrow keys to select a day, then select a count to open its calls. Total and OK counts are available below.`,
			empty: "No calls.",
			series: series.map(([key, label]) => ({
				key,
				label,
				plotted: key !== "calls" && key !== "ok",
				className: `ring-${key}`,
			})),
			select: (day, key) => {
				if (key === "calls") select(day, "all");
				else {
					const outcome = OUTCOMES.find(([name]) => name === key);
					if (outcome) select(day, outcome[0]);
				}
			},
			actionLabel: "View calls",
			detail: (day) => `${errorRate(day)} error rate`,
		},
	);
}
