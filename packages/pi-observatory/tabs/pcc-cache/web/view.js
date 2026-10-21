// @ts-check
import { connectTab, queryTab } from "/tab-client.js";
import { renderRebillCharts } from "./charts.js";
import { count, element, renderMetrics, renderRows } from "./render.js";

/** @typedef {import('../contracts.ts').CacheSnapshot} CacheSnapshot */
/** @typedef {import('../contracts.ts').CacheQueryResult} CacheQueryResult */

/** @type {CacheSnapshot | null} */
let snapshot = null;
/** @type {Partial<Record<'session' | 'project' | 'since' | 'until', string>>} */
let filters = {};
/** @type {AbortController | undefined} */
let active;
let offset = 0;
let lastUpdatedAt = "";
/** @param {string} id */
const select = (id) => /** @type {HTMLSelectElement} */ (element(id));

/** @param {string} id @param {string[]} values @param {string} all @param {(value: string) => string} label */
function choices(id, values, all, label) {
	const control = select(id),
		selected = control.value;
	const available = [...values];
	if (selected && !available.includes(selected)) available.push(selected);
	if (
		JSON.stringify(
			[...control.options].slice(1).map((option) => option.value),
		) !== JSON.stringify(available)
	) {
		control.replaceChildren(
			new Option(all, ""),
			...available.map((value) => new Option(label(value), value)),
		);
		control.value = selected;
	}
	return available.length;
}

/** @param {unknown} data @returns {data is CacheSnapshot} */
function validSnapshot(data) {
	if (!data || typeof data !== "object") return false;
	const value = /** @type {CacheSnapshot} */ (data);
	return (
		value.version === 2 &&
		Boolean(value.coverage) &&
		typeof value.coverage.directoryAvailable === "boolean" &&
		Array.isArray(value.models) &&
		value.models.every((model) => typeof model === "string")
	);
}

/** @param {unknown} data @returns {data is CacheQueryResult} */
function validResult(data) {
	if (!data || typeof data !== "object") return false;
	const value = /** @type {CacheQueryResult} */ (data);
	return (
		value.version === 1 &&
		Boolean(value.totals) &&
		Number.isFinite(value.totals.inputTokens) &&
		Number.isFinite(value.totals.rebillMisses) &&
		Number.isFinite(value.totals.rebillCost) &&
		Number.isFinite(value.total) &&
		Number.isFinite(value.offset) &&
		value.limit === 50 &&
		Array.isArray(value.days) &&
		Array.isArray(value.requests)
	);
}

function renderCoverage() {
	if (!snapshot) return;
	const c = snapshot.coverage;
	const notices = [];
	if (!c.directoryAvailable || !c.files) notices.push("No PCC logs");
	else if (c.pendingBytes)
		notices.push(`Indexing ${count(c.indexedFiles)} / ${count(c.files)} logs`);
	if (c.rebillPendingFiles)
		notices.push(
			`Updating cache history · ${count(c.rebillPendingFiles)} logs remaining`,
		);
	for (const [value, label] of [
		[c.partialFiles, "partial logs"],
		[c.malformed, "malformed lines"],
		[c.invalidUsage, "invalid usage records"],
		[c.rewrittenFiles, "rewritten logs"],
		[c.missingFiles, "missing logs"],
		[c.unreadableFiles, "unreadable logs"],
	]) {
		if (value) notices.push(`${count(Number(value))} ${label}`);
	}
	element("coverage").textContent = notices.join(" · ");
	element("coverage").hidden = !notices.length;
}

/** @param {boolean} [background] */
async function refresh(background = false) {
	if (!snapshot || (background && active)) return;
	active?.abort();
	const controller = (active = new AbortController());
	const results = element("results");
	if (!background) {
		results.setAttribute("aria-busy", "true");
		/** @type {HTMLButtonElement} */ (element("previous")).disabled = true;
		/** @type {HTMLButtonElement} */ (element("next")).disabled = true;
		element("query-status").hidden = false;
		element("query-message").textContent = "Loading…";
		element("retry").hidden = true;
	}
	try {
		const value = await queryTab(
			{
				...filters,
				model: select("model").value,
				lane: select("lane").value,
				scope: select("scope").value,
				result: select("result").value,
				offset,
			},
			controller.signal,
		);
		if (active !== controller) return;
		if (!validResult(value)) throw new Error("Could not read cache data.");
		offset = value.offset;
		renderMetrics(value.totals);
		renderRebillCharts(value.days, value.totals);
		renderRows(value.requests, value.offset, value.total);
		results.hidden = false;
		element("query-status").hidden = true;
	} catch (error) {
		if (controller.signal.aborted || active !== controller) return;
		results.hidden = true;
		element("query-status").hidden = false;
		element("query-message").textContent =
			error instanceof Error ? error.message : "Could not load cache data.";
		element("retry").hidden = false;
	} finally {
		if (active === controller) {
			active = undefined;
			results.removeAttribute("aria-busy");
		}
	}
}

for (const id of ["model", "lane", "scope", "result"])
	select(id).addEventListener("change", () => {
		offset = 0;
		void refresh();
	});
element("previous").addEventListener("click", () => {
	offset = Math.max(0, offset - 50);
	void refresh();
});
element("next").addEventListener("click", () => {
	offset += 50;
	void refresh();
});
element("retry").addEventListener("click", () => {
	void refresh();
});
window.addEventListener("pagehide", () => active?.abort());

connectTab(({ data, status, filters: nextFilters }) => {
	if (data === null) return;
	const changedFilters =
		JSON.stringify(filters) !== JSON.stringify(nextFilters);
	if (snapshot && status.updatedAt === lastUpdatedAt && !changedFilters) return;
	if (!validSnapshot(data)) {
		element("waiting").hidden = false;
		element("waiting").textContent = "Waiting for cache data…";
		element("dashboard").hidden = true;
		return;
	}
	if (changedFilters) offset = 0;
	const background = snapshot !== null && !changedFilters;
	lastUpdatedAt = status.updatedAt ?? "";
	filters = nextFilters;
	snapshot = data;
	choices("model", data.models, "All models", (value) =>
		value === "Unknown" ? "Unknown model" : value,
	);
	const scopes = choices("scope", data.scopes ?? [], "All scopes", (value) =>
		value === "Unknown"
			? "Unknown scope"
			: value === "session"
				? "Session"
				: value === "auxiliary"
					? "Auxiliary"
					: value,
	);
	element("scope-filter").hidden = scopes < 2 && !select("scope").value;
	element("waiting").hidden = true;
	element("dashboard").hidden = false;
	renderCoverage();
	void refresh(background);
});
