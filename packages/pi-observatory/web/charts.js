// @ts-check
/** @typedef {import('../src/contracts.ts').Counts & { day: string }} Day */
/** @typedef {{ label: string, calls: number, error: number, select: () => void }} UsageRow */

/** @param {UsageRow[]} rows @param {number} total */
export function usageChart(rows, total) {
	if (!rows.length) {
		const empty = document.createElement("p");
		empty.textContent = "No calls.";
		return empty;
	}
	const list = document.createElement("ol");
	list.className = "usage-bars";
	const maximum = Math.max(1, ...rows.map((row) => row.calls));
	for (const row of rows) {
		const item = document.createElement("li");
		const button = document.createElement("button");
		button.type = "button";
		button.className = "usage-bar";
		button.addEventListener("click", row.select);
		const heading = document.createElement("span");
		heading.className = "bar-heading";
		const label = document.createElement("span");
		label.className = "bar-label";
		label.textContent = row.label;
		const value = document.createElement("span");
		value.className = "bar-count";
		value.textContent = row.calls.toLocaleString();
		const share = total ? (100 * row.calls) / total : 0;
		const detail = document.createElement("span");
		detail.className = "bar-share";
		detail.textContent =
			share > 0 && share < 0.1 ? "<0.1%" : `${share.toFixed(1)}%`;
		heading.append(label, value, detail);
		const track = document.createElement("span");
		track.className = "bar-track";
		track.setAttribute("aria-hidden", "true");
		const fill = document.createElement("span");
		fill.className = "bar-fill";
		fill.style.width = `${(100 * row.calls) / maximum}%`;
		track.append(fill);
		button.append(heading, track);
		button.setAttribute(
			"aria-label",
			`${row.label}: ${row.calls.toLocaleString()} calls, ${row.error.toLocaleString()} errors. View calls`,
		);
		if (row.error) button.title = `${row.error.toLocaleString()} errors`;
		item.append(button);
		list.append(item);
	}
	return list;
}

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

/** @template {keyof SVGElementTagNameMap} T @param {T} tag @param {Record<string, string | number>} [attrs] */
function svg(tag, attrs = {}) {
	const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
	for (const [name, value] of Object.entries(attrs))
		node.setAttribute(name, String(value));
	return node;
}

/** @param {import('../src/contracts.ts').Counts} counts @param {(outcome: import('../src/contracts.ts').Outcome) => void} select */
export function outcomeChart(counts, select) {
	const container = document.createElement("div");
	container.className = "outcome-distribution";
	if (!counts.calls) {
		container.textContent = "No calls in this selection.";
		return container;
	}
	const outcomes = /** @type {const} */ ([
		["ok", "OK"],
		["error", "Errors"],
		["nonzero", "Nonzero exits"],
		["incomplete", "No final result"],
		["unknown", "Unclassified"],
	]);
	const chart = svg("svg", {
		viewBox: "0 0 180 180",
		role: "img",
		"aria-label": outcomes
			.map(([key, label]) => `${label}: ${counts[key].toLocaleString()}`)
			.join(", "),
	});
	chart.classList.add("outcome-ring");
	let offset = 0;
	for (const [key] of outcomes) {
		const share = (counts[key] / counts.calls) * 100;
		if (!share) continue;
		chart.append(
			svg("circle", {
				cx: 90,
				cy: 90,
				r: 70,
				pathLength: 100,
				fill: "none",
				"stroke-width": 18,
				"stroke-dasharray": `${share} ${100 - share}`,
				"stroke-dashoffset": -offset,
				transform: "rotate(-90 90 90)",
				class: `ring-${key}`,
			}),
		);
		offset += share;
	}
	const value = svg("text", {
		x: 90,
		y: 88,
		"text-anchor": "middle",
		class: "ring-value",
	});
	value.textContent = `${((counts.ok / counts.calls) * 100).toFixed(1)}%`;
	const label = svg("text", {
		x: 90,
		y: 109,
		"text-anchor": "middle",
		class: "chart-axis",
	});
	label.textContent = "OK outcomes";
	chart.append(value, label);
	const legend = document.createElement("ul");
	legend.className = "outcome-legend";
	for (const [key, label] of outcomes) {
		const item = document.createElement("li");
		const button = document.createElement("button");
		button.type = "button";
		button.addEventListener("click", () => select(key));
		const swatch = document.createElement("span");
		swatch.className = `outcome-swatch ring-${key}`;
		swatch.setAttribute("aria-hidden", "true");
		const name = document.createElement("span");
		name.textContent = label;
		const count = document.createElement("strong");
		count.textContent = counts[key].toLocaleString();
		button.append(swatch, name, count);
		item.append(button);
		legend.append(item);
	}
	container.append(chart, legend);
	return container;
}

/** @param {Day[]} days @param {"calls" | "error"} metric @param {number} width @param {(day: string) => void} select */
export function activityChart(days, metric, width, select) {
	if (!days.length) {
		const empty = document.createElement("p");
		empty.textContent = "No calls.";
		return empty;
	}
	width = Math.max(240, width);
	const height = 210;
	const left = 44,
		right = width - 16,
		top = 14,
		bottom = height - 30;
	const maximum = Math.max(1, ...days.map((day) => day[metric]));
	const unit = 10 ** Math.floor(Math.log10(maximum / 2));
	const step = Math.max(1, Math.ceil(maximum / 2 / unit) * unit);
	const ceiling = step * 2;
	const x = (/** @type {number} */ i) =>
		days.length === 1
			? (left + right) / 2
			: left + (i / (days.length - 1)) * (right - left);
	const y = (/** @type {number} */ value) =>
		bottom - (value / ceiling) * (bottom - top);
	const chart = svg("svg", {
		viewBox: `0 0 ${width} ${height}`,
		role: "group",
		"aria-labelledby": "activity-title",
	});
	chart.classList.add(
		"activity-chart",
		metric === "error" ? "error-series" : "call-series",
	);
	const title = svg("title", { id: "activity-title" });
	title.textContent = `Daily ${metric === "error" ? "errors" : "calls"}, ${days[0]?.day} to ${days.at(-1)?.day}. Arrow keys choose a day. Enter opens its ${metric === "error" ? "errors" : "calls"}.`;
	chart.append(title);
	const compact = new Intl.NumberFormat(undefined, {
		notation: "compact",
		maximumFractionDigits: 1,
	});
	for (const value of [0, step, ceiling]) {
		chart.append(
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
		chart.append(label);
	}
	const points = days.map((day, i) => `${x(i)},${y(day[metric])}`).join(" ");
	chart.append(
		svg("polygon", {
			points: `${x(0)},${bottom} ${points} ${x(days.length - 1)},${bottom}`,
			class: "chart-area",
		}),
		svg("polyline", { points, class: "chart-line" }),
	);
	const container = document.createElement("div");
	const readout = document.createElement("p");
	readout.className = "activity-readout";
	const guide = svg("line", { y1: top, y2: bottom, class: "activity-guide" });
	chart.append(guide);
	/** @type {SVGGElement[]} */
	const targets = [];
	/** @param {Day} day */
	function detail(day) {
		const completed = day.ok + day.error + day.nonzero;
		const percentage = completed ? (day.error / completed) * 100 : 0;
		const rate = !completed
			? "—"
			: percentage > 0 && percentage < 0.1
				? "<0.1%"
				: `${percentage.toFixed(1)}%`;
		return `${day.day} UTC · ${day.calls.toLocaleString()} calls · ${day.error.toLocaleString()} errors · ${rate} error rate`;
	}
	/** @param {number} index */
	function inspect(index) {
		const day = days[index];
		if (!day) return;
		readout.textContent = detail(day);
		guide.setAttribute("x1", String(x(index)));
		guide.setAttribute("x2", String(x(index)));
		for (const [i, target] of targets.entries()) {
			target.setAttribute("tabindex", i === index ? "0" : "-1");
			target.classList.toggle("active-day", i === index);
		}
	}
	for (const [i, day] of days.entries()) {
		const target = svg("g", {
			role: "button",
			tabindex: "-1",
			class: "activity-day",
			"aria-label": `${detail(day)}. View ${metric === "error" ? "errors" : "calls"}`,
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
		const point = svg("circle", {
			cx: x(i),
			cy: y(day[metric]),
			r: days.length === 1 ? 5 : days.length > 30 ? 2 : 3,
			class: "chart-point",
		});
		target.append(point);
		target.addEventListener("pointerenter", () => {
			// Keep the readout aligned with the day Enter will activate.
			if (!chart.contains(document.activeElement)) inspect(i);
		});
		target.addEventListener("focus", () => inspect(i));
		target.addEventListener("click", () => select(day.day));
		target.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				select(day.day);
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
	container.append(readout, chart);
	return container;
}
