// @ts-check
/** @typedef {import('../contracts.ts').CacheRequest} CacheRequest */
/** @typedef {import('../contracts.ts').CacheTotals} CacheTotals */
/** @typedef {import('../contracts.ts').CacheDay} CacheDay */

/** @param {string} id */
export function element(id) {
	const found = document.getElementById(id);
	if (!found) throw new Error(`Missing page element: ${id}`);
	return found;
}
/** @param {number} n */
export const count = (n) => n.toLocaleString();
/** @param {number} part @param {number} total */
const percent = (part, total) =>
	total > 0 ? `${((100 * part) / total).toFixed(1)}%` : "—";
/** @param {string} tag @param {string} text @param {string} [className] */
function node(tag, text, className = "") {
	const result = document.createElement(tag);
	result.textContent = text;
	result.className = className;
	return result;
}

/** @param {CacheTotals} totals */
export function renderMetrics(totals) {
	const input = totals.inputTokens,
		cached = totals.cachedTokens,
		measured = totals.measuredRequests;
	/** @type {[string, string, string][]} */
	const metrics = [
		[
			"Cached input share",
			percent(cached, input),
			`${count(cached)} / ${count(input)} tokens`,
		],
		[
			"Request hit rate",
			percent(totals.hits, measured),
			`${count(totals.hits)} hits · ${count(totals.misses)} misses`,
		],
		[
			"Measured requests",
			count(measured),
			`${count(totals.unknownUsage)} unknown`,
		],
		[
			"Retries / failures",
			`${count(totals.retries)} / ${count(totals.failures)}`,
			`${count(totals.fallbacks)} fallbacks`,
		],
	];
	element("metrics").replaceChildren(
		...metrics.map(([label, value, detail]) => {
			const card = node("div", "", "metric");
			card.append(
				node("span", label),
				node("strong", value),
				node("p", detail),
			);
			return card;
		}),
	);
}

/** @param {CacheDay[]} buckets */
export function renderChart(buckets) {
	/** @type {Map<string, {input: number, cached: number, hits: number, misses: number}>} */
	const days = new Map();
	for (const bucket of buckets) {
		const day = days.get(bucket.day) ?? {
			input: 0,
			cached: 0,
			hits: 0,
			misses: 0,
		};
		day.input += bucket.inputTokens;
		day.cached += bucket.cachedTokens;
		day.hits += bucket.hits;
		day.misses += bucket.misses;
		days.set(bucket.day, day);
	}
	const dates = [...days.keys()].sort();
	const chart = element("chart");
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
	const max = Math.max(1, ...[...days.values()].map((day) => day.input));
	const bars = node("div", "", "bars");
	bars.setAttribute("role", "list");
	bars.setAttribute(
		"aria-label",
		"Daily input tokens; focus a day for its totals",
	);
	const first = dates[0] ?? "",
		last = dates.at(-1) ?? first;
	const detail = node("p", "", "muted");
	detail.hidden = true;
	detail.setAttribute("aria-live", "polite");
	for (
		let time = Date.parse(first);
		time <= Date.parse(last);
		time += 86400000
	) {
		const date = new Date(time).toISOString().slice(0, 10);
		const day = days.get(date) ?? { input: 0, cached: 0, hits: 0, misses: 0 };
		const bar = node("div", "", "day");
		bar.dataset["day"] = date;
		bar.tabIndex = date === (focusedDay || first) ? 0 : -1;
		bar.setAttribute("role", "listitem");
		const label = `${date}: ${count(day.cached)} cached / ${count(day.input)} input tokens (${percent(day.cached, day.input)}), ${count(day.hits)} hits, ${count(day.misses)} misses`;
		bar.title = label;
		bar.setAttribute("aria-label", label);
		bar.addEventListener("mouseenter", () => {
			detail.textContent = label;
			detail.hidden = false;
		});
		bar.addEventListener("focus", () => {
			detail.textContent = label;
			detail.hidden = false;
		});
		bar.addEventListener("keydown", (event) => {
			const target =
				event.key === "ArrowRight"
					? bar.nextElementSibling
					: event.key === "ArrowLeft"
						? bar.previousElementSibling
						: null;
			if (target instanceof HTMLElement) {
				event.preventDefault();
				bar.tabIndex = -1;
				target.tabIndex = 0;
				target.focus();
			}
		});
		const uncached = node("div", "", "uncached"),
			cached = node("div", "", "cached");
		uncached.style.height = `${(100 * (day.input - day.cached)) / max}%`;
		cached.style.height = `${(100 * day.cached) / max}%`;
		bar.append(uncached, cached);
		bars.append(bar);
	}
	const labels = node("div", "", "chart-dates");
	labels.append(node("span", first), node("span", last));
	chart.append(bars, labels, detail);
	if (focusedDay) {
		const target = [...bars.children].find(
			(bar) => bar instanceof HTMLElement && bar.dataset["day"] === focusedDay,
		);
		if (target instanceof HTMLElement) target.focus({ preventScroll: true });
		else if (bars.firstElementChild instanceof HTMLElement)
			bars.firstElementChild.tabIndex = 0;
	}
}

/** @param {CacheRequest[]} requests @param {number} offset @param {number} total */
export function renderRows(requests, offset, total) {
	const rows = requests.map((request) => {
		const row = document.createElement("tr");
		/** @param {string} text @param {string} [detail] @param {string} [className] */
		const cell = (text, detail = "", className = "") => {
			const td = node("td", text, className);
			if (detail) td.append(node("small", detail));
			row.append(td);
			return td;
		};
		cell(
			new Date(request.time).toLocaleString(),
			request.sessionName || request.sessionId || "Unknown session",
		).title = request.project || "Unknown project";
		cell(request.model, `${request.lane} · ${request.scope}`);
		cell(
			request.measurement === "unknown"
				? "Unknown"
				: request.measurement === "hit"
					? "Hit"
					: "Miss",
			request.inputTokens !== null && request.cachedTokens !== null
				? percent(request.cachedTokens, request.inputTokens)
				: "",
			request.measurement,
		);
		cell(
			`${request.cachedTokens === null ? "—" : count(request.cachedTokens)} / ${request.inputTokens === null ? "—" : count(request.inputTokens)}`,
			`${request.outputTokens === null ? "—" : count(request.outputTokens)} output`,
		);
		cell(
			request.transport,
			[
				request.continuation,
				request.canonicalHistory && `Canonical: ${request.canonicalHistory}`,
			]
				.filter(Boolean)
				.join(" · "),
		);
		const outcome = cell(
			request.status,
			[
				request.retries ? `${request.retries} retries` : "",
				request.fallbacks ? `${request.fallbacks} fallbacks` : "",
				request.correlation === "legacy" ? `Uncorrelated ${request.kind}` : "",
			]
				.filter(Boolean)
				.join(" · "),
			request.status === "failed" ? "issue" : "",
		);
		outcome.title = [
			request.localId,
			request.failureCategory,
			request.failureCode,
			`${request.attempts} logged attempts`,
		]
			.filter(Boolean)
			.join(" · ");
		cell(
			request.latencyMs === null
				? "—"
				: `${(request.latencyMs / 1000).toFixed(1)} s`,
		);
		return row;
	});
	if (!rows.length) {
		const row = document.createElement("tr"),
			cell = document.createElement("td");
		cell.colSpan = 7;
		cell.textContent = "No requests.";
		row.append(cell);
		rows.push(row);
	}
	element("rows").replaceChildren(...rows);
	element("page-status").textContent = requests.length
		? `${count(offset + 1)}–${count(offset + requests.length)} of ${count(total)}`
		: "0 requests";
	/** @type {HTMLButtonElement} */ (element("previous")).disabled =
		offset === 0;
	/** @type {HTMLButtonElement} */ (element("next")).disabled =
		offset + requests.length >= total;
}
