// @ts-check
/** @typedef {import('../contracts.ts').CacheRequest} CacheRequest */
/** @typedef {import('../contracts.ts').CacheTotals} CacheTotals */

/** @param {string} id */
export function element(id) {
	const found = document.getElementById(id);
	if (!found) throw new Error(`Missing page element: ${id}`);
	return found;
}
/** @param {number} n */
export const count = (n) => n.toLocaleString();
const tokenFormat = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 2,
});
/** @param {number | null} n */
const tokens = (n) => (n === null ? "—" : tokenFormat.format(n));
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
	/** @type {[string, string, string, string?][]} */
	const metrics = [
		[
			"Cached input share",
			percent(cached, input),
			`${tokens(cached)} / ${tokens(input)} tokens`,
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
			`${count(totals.unknownUsage)} unmeasured`,
		],
		[
			"Retries / failures",
			`${count(totals.retries)} / ${count(totals.failures)}`,
			`${count(totals.fallbacks)} fallbacks`,
		],
	];
	element("metrics").replaceChildren(
		...metrics.map(([label, value, detail, exact]) => {
			const card = node("div", "", "metric");
			const description = node("p", detail);
			if (exact) {
				description.title = exact;
				description.setAttribute("aria-label", exact);
			}
			card.append(node("span", label), node("strong", value), description);
			return card;
		}),
	);
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
		cell(
			request.model,
			[request.lane, request.scope === "Unknown" ? "" : request.scope]
				.filter(Boolean)
				.join(" · "),
		);
		cell(
			request.measurement === "unknown"
				? "Unmeasured"
				: request.measurement === "hit"
					? "Hit"
					: "Miss",
			request.rebill
				? "Mid-flight"
				: request.inputTokens !== null && request.cachedTokens !== null
					? percent(request.cachedTokens, request.inputTokens)
					: "",
			request.measurement,
		);
		const tokenCell = cell(
			`${tokens(request.cachedTokens)} / ${tokens(request.inputTokens)}`,
			`${tokens(request.outputTokens)} output`,
		);
		tokenCell.title = [
			`${request.cachedTokens === null ? "—" : count(request.cachedTokens)} / ${request.inputTokens === null ? "—" : count(request.inputTokens)}`,
			`${request.outputTokens === null ? "—" : count(request.outputTokens)} output`,
		].join(" · ");
		tokenCell.setAttribute("aria-label", tokenCell.title);
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
