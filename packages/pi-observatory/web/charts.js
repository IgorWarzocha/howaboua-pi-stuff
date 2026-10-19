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

/** @param {Day[]} days @param {"calls" | "error"} metric @param {number} width */
export function activityChart(days, metric, width) {
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
		role: "img",
		"aria-labelledby": "activity-title",
	});
	chart.classList.add(
		"activity-chart",
		metric === "error" ? "error-series" : "call-series",
	);
	const title = svg("title", { id: "activity-title" });
	title.textContent = `Daily ${metric === "error" ? "errors" : "calls"}, ${days[0]?.day} to ${days.at(-1)?.day}. ${days.reduce((sum, day) => sum + day[metric], 0).toLocaleString()} total. Exact counts in the table below.`;
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
	for (const [i, day] of days.entries()) {
		const point = svg("circle", {
			cx: x(i),
			cy: y(day[metric]),
			r: days.length === 1 ? 5 : days.length > 30 ? 2 : 3,
			class: "chart-point",
		});
		const label = svg("title");
		label.textContent = `${day.day}: ${day[metric].toLocaleString()} ${metric === "error" ? "errors" : "calls"}`;
		point.append(label);
		chart.append(point);
	}
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
	return chart;
}
