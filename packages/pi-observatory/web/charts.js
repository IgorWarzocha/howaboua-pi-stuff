// @ts-check
import { OUTCOMES, svg } from "./view-dom.js";
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

/** @param {import('../src/contracts.ts').Counts} counts @param {(outcome: import('../src/contracts.ts').Outcome) => void} select */
export function outcomeChart(counts, select) {
	const container = document.createElement("div");
	container.className = "outcome-distribution";
	if (!counts.calls) {
		container.textContent = "No calls in this selection.";
		return container;
	}
	const chart = svg("svg", {
		viewBox: "0 0 180 180",
		role: "img",
		"aria-label": OUTCOMES.map(
			([key, label]) => `${label}: ${counts[key].toLocaleString()}`,
		).join(", "),
	});
	chart.classList.add("outcome-ring");
	let offset = 0;
	for (const [key] of OUTCOMES) {
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
	for (const [key, label] of OUTCOMES) {
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
