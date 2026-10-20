// @ts-check
import { OUTCOMES, svg } from "./view-dom.js";

/** @typedef {import('../src/contracts.ts').Counts & { day: string }} Day */

const DAY = 86_400_000;

/** @param {Day[]} rows @returns {Day[]} */
export function dailySeries(rows) {
	const known = rows.filter(
		(row) =>
			/^\d{4}-\d{2}-\d{2}$/.test(row.day) &&
			Number.isFinite(Date.parse(row.day)),
	);
	if (!known.length) return [];
	const times = known.map((row) => Date.parse(row.day));
	const end = Math.max(...times);
	const start = Math.max(Math.min(...times), end - 89 * DAY);
	const byDay = new Map(known.map((row) => [row.day, row]));
	const days = [];
	for (let time = start; time <= end; time += DAY) {
		const day = new Date(time).toISOString().slice(0, 10);
		days.push(
			byDay.get(day) ?? {
				day,
				calls: 0,
				ok: 0,
				error: 0,
				nonzero: 0,
				incomplete: 0,
				unknown: 0,
			},
		);
	}
	return days;
}

/** @param {Day[]} days @param {number} width @param {(day: string, outcome: import('../src/contracts.ts').Outcome | "all") => void} select */
export function activityChart(days, width, select) {
	if (!days.length) {
		const empty = document.createElement("p");
		empty.textContent = "No calls.";
		return empty;
	}
	width = Math.max(240, width);
	const height = 210;
	const left = 44,
		right = width - 16,
		top = 20,
		bottom = height - 30;
	const series = /** @type {const} */ ([["calls", "Total calls"], ...OUTCOMES]);
	const x = (/** @type {number} */ i) =>
		days.length === 1
			? (left + right) / 2
			: left + (i / (days.length - 1)) * (right - left);
	const chart = svg("svg", {
		viewBox: `0 0 ${width} ${height}`,
		role: "group",
		"aria-labelledby": "activity-title",
	});
	chart.classList.add("activity-chart");
	const title = svg("title", { id: "activity-title" });
	title.textContent = `Daily calls, ${days[0]?.day} to ${days.at(-1)?.day}. Total and OK use the upper count scale; other outcomes use a separate lower count scale. Use arrow keys to select a day, then select a count to open its calls.`;
	chart.append(title);
	const compact = new Intl.NumberFormat(undefined, {
		notation: "compact",
		maximumFractionDigits: 1,
	});
	/** @param {string} name @param {ReadonlyArray<readonly [keyof import('../src/contracts.ts').Counts, string]>} lines @param {number} start @param {number} end */
	function plot(name, lines, start, end) {
		const maximum = Math.max(
			1,
			...days.flatMap((day) => lines.map(([key]) => day[key])),
		);
		const unit = 10 ** Math.floor(Math.log10(maximum / 2));
		const step = Math.max(1, Math.ceil(maximum / 2 / unit) * unit);
		const ceiling = step * 2;
		const y = (/** @type {number} */ value) =>
			end - (value / ceiling) * (end - start);
		const group = svg("g", {
			role: "group",
			"aria-label": `${name}: 0 to ${ceiling.toLocaleString()} calls`,
		});
		const heading = svg("text", { x: left, y: start - 9, class: "chart-axis" });
		heading.textContent = name;
		group.append(heading);
		for (const value of [0, step, ceiling]) {
			group.append(
				svg("line", {
					x1: left,
					x2: right,
					y1: y(value),
					y2: y(value),
					class: "chart-grid",
				}),
			);
			const label = svg("text", {
				x: left - 8,
				y: y(value) + 4,
				"text-anchor": "end",
				class: "chart-axis",
			});
			label.textContent = compact.format(value);
			group.append(label);
		}
		for (const [key] of lines) {
			const points = days.map((day, i) => `${x(i)},${y(day[key])}`).join(" ");
			if (key === "calls")
				group.append(
					svg("polygon", {
						points: `${x(0)},${end} ${points} ${x(days.length - 1)},${end}`,
						class: "chart-area",
					}),
				);
			group.append(
				svg("polyline", {
					points,
					class: `chart-line ring-${key}`,
					"data-series": key,
				}),
			);
		}
		const guide = svg("line", { y1: start, y2: end, class: "activity-guide" });
		group.append(guide);
		chart.append(group);
		return { y, guide };
	}
	const volume = plot(
		"Total and OK",
		series.filter(([key]) => key === "calls" || key === "ok"),
		top,
		80,
	);
	const other = plot(
		"Other outcomes",
		series.filter(([key]) => key !== "calls" && key !== "ok"),
		116,
		bottom,
	);
	/** @param {keyof import('../src/contracts.ts').Counts} key @param {number} value */
	const y = (key, value) =>
		(key === "calls" || key === "ok" ? volume : other).y(value);
	const container = document.createElement("div");
	const readout = document.createElement("p");
	readout.className = "activity-readout";
	const legend = document.createElement("ul");
	legend.className = "activity-legend";
	let selected = days.length - 1;
	const counts = series.map(([key, label]) => {
		const item = document.createElement("li");
		const button = document.createElement("button");
		button.type = "button";
		const swatch = document.createElement("span");
		swatch.className = `activity-swatch ring-${key}`;
		swatch.setAttribute("aria-hidden", "true");
		const name = document.createElement("span");
		name.textContent = label;
		const count = document.createElement("strong");
		button.append(swatch, name, count);
		button.addEventListener("click", () => {
			const day = days[selected];
			if (day) select(day.day, key === "calls" ? "all" : key);
		});
		item.append(button);
		legend.append(item);
		return { key, label, button, count };
	});
	/** @type {SVGGElement[]} */
	const targets = [];
	/** @param {Day} day */
	function errorRate(day) {
		const completed = day.ok + day.error + day.nonzero;
		const percentage = completed ? (day.error / completed) * 100 : 0;
		return !completed
			? "—"
			: percentage > 0 && percentage < 0.1
				? "<0.1%"
				: `${percentage.toFixed(1)}%`;
	}
	/** @param {Day} day */
	function detail(day) {
		return `${day.day} UTC. ${series.map(([key, label]) => `${day[key].toLocaleString()} ${label}`).join(", ")}. ${errorRate(day)} error rate`;
	}
	/** @param {number} index */
	function inspect(index) {
		const day = days[index];
		if (!day) return;
		selected = index;
		readout.textContent = `${day.day} UTC · ${errorRate(day)} error rate`;
		for (const { key, label, button, count } of counts) {
			count.textContent = day[key].toLocaleString();
			button.setAttribute(
				"aria-label",
				`${day.day}: ${day[key].toLocaleString()} ${label}. View calls`,
			);
		}
		for (const { guide } of [volume, other]) {
			guide.setAttribute("x1", String(x(index)));
			guide.setAttribute("x2", String(x(index)));
		}
		for (const [i, target] of targets.entries()) {
			target.setAttribute("tabindex", i === index ? "0" : "-1");
			target.setAttribute("aria-pressed", String(i === index));
			target.classList.toggle("active-day", i === index);
		}
	}
	for (const [i, day] of days.entries()) {
		const target = svg("g", {
			role: "button",
			tabindex: "-1",
			class: "activity-day",
			"aria-label": `${detail(day)}. Select day`,
		});
		const from = i === 0 ? left - 8 : (x(i - 1) + x(i)) / 2;
		const to = i === days.length - 1 ? right + 8 : (x(i) + x(i + 1)) / 2;
		target.append(
			svg("rect", {
				x: from,
				y: top,
				width: to - from,
				height: bottom - top,
				class: "activity-hit",
			}),
		);
		for (const [key] of series)
			target.append(
				svg("circle", {
					cx: x(i),
					cy: y(key, day[key]),
					r: 3,
					class: `chart-point ring-${key}`,
				}),
			);
		target.addEventListener("pointerenter", () => {
			// Keep the selected day stable while moving focus to its outcome counts.
			if (!container.contains(document.activeElement)) inspect(i);
		});
		target.addEventListener("focus", () => inspect(i));
		target.addEventListener("click", () => target.focus());
		target.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				inspect(i);
				return;
			}
			const next =
				event.key === "ArrowLeft"
					? i - 1
					: event.key === "ArrowRight"
						? i + 1
						: event.key === "Home"
							? 0
							: event.key === "End"
								? days.length - 1
								: undefined;
			if (next === undefined) return;
			event.preventDefault();
			targets[Math.max(0, Math.min(days.length - 1, next))]?.focus();
		});
		targets.push(target);
		chart.append(target);
	}
	inspect(days.length - 1);
	const dates = new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
	const ticks =
		days.length < 3
			? [0, days.length - 1]
			: [0, Math.floor((days.length - 1) / 2), days.length - 1];
	for (const i of new Set(ticks)) {
		const day = days[i];
		if (!day) continue;
		const label = svg("text", {
			x: x(i),
			y: height - 6,
			"text-anchor":
				days.length === 1
					? "middle"
					: i === 0
						? "start"
						: i === days.length - 1
							? "end"
							: "middle",
			class: "chart-axis",
		});
		label.textContent = dates.format(new Date(day.day));
		chart.append(label);
	}
	container.append(readout, chart, legend);
	return container;
}
