// @ts-check
import { count, element } from "./render.js";

/** @typedef {import('../contracts.ts').CacheDay} CacheDay */
/** @typedef {import('../contracts.ts').CacheTotals} CacheTotals */

/** @param {number} value */
const money = (value) =>
	value > 0 && value < 0.01
		? `$${value.toPrecision(2)}`
		: value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** @param {number} value */
const missWord = (value) => (value === 1 ? "miss" : "misses");

/** @param {string} tag @param {string} text @param {string} [className] */
function node(tag, text, className = "") {
	const result = document.createElement(tag);
	result.textContent = text;
	result.className = className;
	return result;
}

/** @param {CacheDay[]} buckets @param {CacheTotals} totals */
export function renderRebillCharts(buckets, totals) {
	element("misses-total").textContent = count(totals.rebillMisses);
	element("cost-total").textContent =
		totals.rebillMisses > 0 &&
		totals.unpricedRebillMisses === totals.rebillMisses
			? "Unpriced"
			: money(totals.rebillCost);
	const excluded = element("rebill-coverage");
	excluded.textContent = `${count(totals.unclassifiedMisses)} unclassified ${missWord(totals.unclassifiedMisses)}`;
	excluded.hidden = !totals.unclassifiedMisses;
	const unpriced = element("cost-coverage");
	unpriced.textContent = `${count(totals.unpricedRebillMisses)} unpriced ${missWord(totals.unpricedRebillMisses)}`;
	unpriced.hidden = !totals.unpricedRebillMisses;
	const days = new Map(buckets.map((day) => [day.day, day]));
	const dates = [...days.keys()].sort();
	/** @type {string[]} */
	const calendar = [];
	for (
		let time = Date.parse(dates[0] ?? "");
		time <= Date.parse(dates.at(-1) ?? "");
		time += 86400000
	) {
		calendar.push(new Date(time).toISOString().slice(0, 10));
	}
	renderDailyChart("misses-chart", calendar, days, "misses");
	renderDailyChart("cost-chart", calendar, days, "cost");
}

/**
 * @param {string} id
 * @param {string[]} dates
 * @param {Map<string, CacheDay>} days
 * @param {'misses' | 'cost'} kind
 */
function renderDailyChart(id, dates, days, kind) {
	const chart = element(id);
	const scrollLeft = chart.scrollLeft;
	const focusedDay =
		chart.contains(document.activeElement) &&
		document.activeElement instanceof HTMLElement
			? document.activeElement.dataset["day"]
			: undefined;
	chart.replaceChildren();
	if (!dates.length) {
		chart.append(node("p", "No activity.", "muted"));
		return;
	}
	const value = (/** @type {CacheDay | undefined} */ day) =>
		(kind === "misses" ? day?.rebillMisses : day?.rebillCost) ?? 0;
	const max = Math.max(0, ...[...days.values()].map(value));
	const plot = node("div", "", "daily-plot");
	const scale = node("div", "", "chart-scale");
	scale.append(
		node("span", kind === "misses" ? count(max) : money(max)),
		node("span", kind === "misses" ? "0" : "$0"),
	);
	const bars = node("div", "", "bars");
	bars.setAttribute("role", "list");
	bars.setAttribute(
		"aria-label",
		`${kind === "misses" ? "Daily mid-flight cache misses" : "Daily rebill cost in USD"}; use arrow keys to move between days`,
	);
	const detail = node("p", "", "chart-detail muted");
	detail.setAttribute("aria-live", "polite");
	const first = dates[0] ?? "";
	const last = dates.at(-1) ?? first;
	for (const date of dates) {
		const day = days.get(date);
		const bar = node("div", "", "day");
		bar.dataset["day"] = date;
		bar.tabIndex = date === (focusedDay || first) ? 0 : -1;
		bar.setAttribute("role", "listitem");
		const misses = day?.rebillMisses ?? 0;
		const unpriced = day?.unpricedRebillMisses ?? 0;
		const cost =
			misses > 0 && misses === unpriced
				? "Unpriced"
				: money(day?.rebillCost ?? 0);
		const label = `${date}: ${count(misses)} mid-flight ${missWord(misses)} · ${cost}${unpriced ? ` · ${count(unpriced)} unpriced` : ""}`;
		bar.title = label;
		bar.setAttribute("aria-label", label);
		const showDetail = () => {
			detail.textContent = label;
		};
		bar.addEventListener("mouseenter", showDetail);
		bar.addEventListener("focus", showDetail);
		bar.addEventListener("keydown", (event) => {
			const target =
				event.key === "ArrowRight"
					? bar.nextElementSibling
					: event.key === "ArrowLeft"
						? bar.previousElementSibling
						: event.key === "Home"
							? bars.firstElementChild
							: event.key === "End"
								? bars.lastElementChild
								: null;
			if (target instanceof HTMLElement) {
				event.preventDefault();
				bar.tabIndex = -1;
				target.tabIndex = 0;
				target.focus();
			}
		});
		const fill = node("div", "", `bar-fill ${kind}`);
		fill.style.height = `${max ? (100 * value(day)) / max : 0}%`;
		if (value(day) > 0) fill.style.minHeight = "2px";
		bar.append(fill);
		if (kind === "cost" && unpriced) {
			bar.append(node("span", "?", "unpriced-day"));
		}
		bars.append(bar);
	}
	const labels = node("div", "", "chart-dates");
	labels.append(node("span", first), node("span", last));
	plot.append(scale, bars, labels);
	chart.append(plot, detail);
	chart.scrollLeft = scrollLeft;
	if (focusedDay) {
		const target = [...bars.children].find(
			(bar) => bar instanceof HTMLElement && bar.dataset["day"] === focusedDay,
		);
		if (target instanceof HTMLElement) target.focus({ preventScroll: true });
		else if (bars.firstElementChild instanceof HTMLElement)
			bars.firstElementChild.tabIndex = 0;
	}
}

for (const [source, target] of [
	["misses-chart", "cost-chart"],
	["cost-chart", "misses-chart"],
]) {
	if (source && target) {
		element(source).addEventListener(
			"scroll",
			() => {
				element(target).scrollLeft = element(source).scrollLeft;
			},
			{ passive: true },
		);
	}
}
