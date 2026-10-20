// @ts-check
import { connectTab } from "/tab-client.js";
import {
	count,
	element,
	renderChart,
	renderMetrics,
	renderRows,
} from "./render.js";

/** @typedef {import('../contracts.ts').CacheSnapshot} CacheSnapshot */
/** @typedef {import('../contracts.ts').CacheBucket} CacheBucket */
/** @typedef {import('../contracts.ts').CacheRequest} CacheRequest */

/** @type {CacheSnapshot | null} */
let snapshot = null;
/** @type {Partial<Record<'session' | 'project' | 'since' | 'until', string>>} */
let filters = {};
let page = 0;
let lastUpdatedAt = "";
/** @param {string} id */
const select = (id) => /** @type {HTMLSelectElement} */ (element(id));

/** @param {unknown} data @returns {data is CacheSnapshot} */
function validSnapshot(data) {
	if (!data || typeof data !== "object") return false;
	const value = /** @type {CacheSnapshot} */ (data);
	return (
		value.version === 1 &&
		Boolean(value.coverage) &&
		typeof value.coverage.directoryAvailable === "boolean" &&
		Array.isArray(value.buckets) &&
		Array.isArray(value.requests) &&
		value.buckets.every(
			(row) =>
				row &&
				typeof row.day === "string" &&
				typeof row.model === "string" &&
				Number.isFinite(row.inputTokens) &&
				Number.isFinite(row.cachedTokens),
		) &&
		value.requests.every(
			(row) =>
				row &&
				typeof row.time === "string" &&
				Number.isFinite(Date.parse(row.time)) &&
				typeof row.model === "string",
		)
	);
}

/** @param {CacheBucket | CacheRequest} row */
function matches(row) {
	const day = "day" in row ? row.day : row.time.slice(0, 10);
	return (
		(!filters.session || row.sessionId === filters.session) &&
		(!filters.project || row.project === filters.project) &&
		(!filters.since || day >= filters.since) &&
		(!filters.until || day <= filters.until) &&
		(!select("model").value || row.model === select("model").value) &&
		(!select("lane").value || row.lane === select("lane").value) &&
		(!select("scope").value || row.scope === select("scope").value)
	);
}

function render() {
	if (!snapshot) return;
	const buckets = snapshot.buckets.filter(matches);
	const requests = snapshot.requests.filter(
		(row) =>
			matches(row) &&
			(!select("result").value || row.measurement === select("result").value),
	);
	page = Math.min(page, Math.max(0, Math.ceil(requests.length / 50) - 1));
	renderMetrics(buckets);
	renderChart(buckets);
	renderRows(requests, page);
	const c = snapshot.coverage;
	const coverage = [];
	if (!c.directoryAvailable)
		coverage.push(
			"No PCC log directory is available. Enable diagnostics in PCC to record future requests; earlier requests cannot be recovered.",
		);
	else if (!c.files)
		coverage.push(
			"No PCC logs found. Diagnostics must be enabled in PCC to record requests.",
		);
	else {
		coverage.push(
			`Log coverage: ${count(c.indexedFiles)} / ${count(c.files)} files${c.fromDay ? ` · ${c.fromDay}–${c.toDay} UTC` : ""}.`,
		);
		if (c.pendingBytes)
			coverage.push(
				`Backfill in progress: ${(c.pendingBytes / 1048576).toFixed(1)} MiB remaining. Counts are partial.`,
			);
		if (c.historyTruncated)
			coverage.push("Older days are outside this bounded snapshot.");
		if (filters.since && c.fromDay && filters.since < c.fromDay)
			coverage.push("The selected range begins before available history.");
		if (c.partialFiles)
			coverage.push(
				`${count(c.partialFiles)} incomplete file tails await more data.`,
			);
		if (c.malformed || c.invalidUsage)
			coverage.push(
				`${count(c.malformed)} malformed lines · ${count(c.invalidUsage)} invalid usage records excluded.`,
			);
		if (c.rewrittenFiles || c.missingFiles || c.unreadableFiles)
			coverage.push(
				`Source gaps: ${count(c.rewrittenFiles)} rewritten, ${count(c.missingFiles)} missing, ${count(c.unreadableFiles)} unreadable files.`,
			);
		if (c.legacyRecords)
			coverage.push(
				`${count(c.legacyRecords)} uncorrelated records in retained history; model attribution may be unknown.`,
			);
	}
	element("coverage").textContent = coverage.join(" ");
	element("request-coverage").textContent =
		`${c.requestsTruncated ? "Only the newest records are retained; older matching details may be absent. Aggregate metrics above cover all retained days." : "All retained details are available."} Cache result filters this table only. Times: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
}

for (const id of ["model", "lane", "scope", "result"])
	select(id).addEventListener("change", () => {
		page = 0;
		render();
	});
element("previous").addEventListener("click", () => {
	page--;
	render();
});
element("next").addEventListener("click", () => {
	page++;
	render();
});

connectTab(({ data, status, filters: nextFilters }) => {
	if (data === null) return;
	const changedFilters =
		JSON.stringify(filters) !== JSON.stringify(nextFilters);
	if (snapshot && status.updatedAt === lastUpdatedAt && !changedFilters) return;
	if (!validSnapshot(data)) {
		element("waiting").hidden = false;
		element("waiting").textContent =
			"The snapshot does not match this page. Check that the collector and page are from the same bundle version.";
		element("dashboard").hidden = true;
		return;
	}
	if (changedFilters) page = 0;
	lastUpdatedAt = status.updatedAt ?? "";
	filters = nextFilters;
	snapshot = data;
	const model = select("model"),
		selected = model.value;
	const models = [...new Set(data.buckets.map((row) => row.model))].sort();
	if (selected && !models.includes(selected)) models.push(selected);
	if (
		JSON.stringify(
			[...model.options].slice(1).map((option) => option.value),
		) !== JSON.stringify(models)
	) {
		model.replaceChildren(
			new Option("All models", ""),
			...models.map((name) => new Option(name, name)),
		);
		model.value = selected;
	}
	element("waiting").hidden = true;
	element("dashboard").hidden = false;
	render();
});
