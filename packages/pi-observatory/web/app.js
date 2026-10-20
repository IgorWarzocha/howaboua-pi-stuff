// @ts-check
import { activityChart, dailySeries, usageChart } from "./charts.js";
import { createUsageView } from "./usage-view.js";

/** @typedef {import('../src/contracts.ts').Counts} Counts */
/** @typedef {import('../src/contracts.ts').CallRow} CallRow */
/** @param {string} id */
function element(id) {
	const node = document.getElementById(id);
	if (!node) throw new Error(`Missing element: ${id}`);
	return node;
}
const form = /** @type {HTMLFormElement} */ (element("filters"));
const renderUsage = createUsageView();
/** @param {string} name */
function field(name) {
	const node = form.elements.namedItem(name);
	if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement))
		throw new Error(`Missing filter: ${name}`);
	return node;
}
const outcome = /** @type {HTMLSelectElement} */ (element("outcome"));
const activityMetric = /** @type {HTMLSelectElement} */ (
	element("activity-metric")
);
const older = /** @type {HTMLButtonElement} */ (element("older"));
const sessionSelect = /** @type {HTMLSelectElement} */ (element("session"));
const sessionSearch = /** @type {HTMLInputElement} */ (
	element("session-search")
);
const entryParams = new URLSearchParams(location.search);
const entrySession = entryParams.get("session") || "";
const initialSession = entryParams.has("current")
	? entryParams.get("current") || ""
	: entrySession;
if (initialSession) {
	entryParams.set("current", initialSession);
	history.replaceState(
		null,
		"",
		`${location.pathname}?${entryParams}${location.hash}`,
	);
	sessionSelect.append(
		new Option(
			`Current session · ${initialSession.slice(0, 8)}`,
			initialSession,
			true,
			entrySession === initialSession,
		),
	);
	element("current-session").hidden = false;
	element("reset-filters").textContent = "Reset to current session";
}
if (entrySession && entrySession !== initialSession)
	sessionSelect.append(
		new Option(`Session · ${entrySession.slice(0, 8)}`, entrySession),
	);
sessionSelect.value = entrySession;
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has("token")) {
	sessionStorage.setItem("pi-observatory-token", fragment.get("token") || "");
	history.replaceState(null, "", location.pathname + location.search);
}
const token = sessionStorage.getItem("pi-observatory-token") || "";
window.addEventListener("hashchange", () => {
	if (new URLSearchParams(location.hash.slice(1)).has("token"))
		location.reload();
});
let revision = -1;
let loadedRevision = -1;
let query = new URLSearchParams();
/** @type {number | null} */ let cursor = null;
/** @type {number | null} */ let nextCursor = null;
/** @type {number | null} */ let selected = null;
/** @type {AbortController | undefined} */ let dataRequest;
/** @type {AbortController | undefined} */ let callsRequest;
/** @type {AbortController | undefined} */ let detailRequest;
/** @type {AbortController | undefined} */ let sessionsRequest;
/** @type {ReturnType<typeof setTimeout> | undefined} */ let sessionSearchTimer;
/** @type {Map<number, HTMLButtonElement>} */ let callButtons = new Map();
/** @type {import('../src/contracts.ts').Overview | undefined} */ let latestOverview;
/** @type {ReturnType<typeof dailySeries> | undefined} */ let activityDays;
/** @param {string} path @param {AbortSignal} [signal] */
async function api(path, signal) {
	const response = await fetch(path, {
		headers: { Authorization: `Bearer ${token}` },
		signal: signal ?? null,
	});
	if (!response.ok)
		throw new Error(
			response.status === 401 || response.status === 403
				? "Authentication failed. Reopen the dashboard URL supplied by the local server."
				: `Request failed (${response.status}). Retry or check the local server.`,
		);
	return response.json();
}
/** @param {unknown} error */
function report(error) {
	if (error instanceof DOMException && error.name === "AbortError") return;
	element("error").textContent =
		error instanceof Error ? error.message : String(error);
	element("error").hidden = false;
}
/** @param {string} tag @param {string} text */
function node(tag, text) {
	const n = document.createElement(tag);
	n.textContent = text;
	return n;
}
/** @param {number} value */
function number(value) {
	return value.toLocaleString();
}
/** @param {Counts} count */
function completed(count) {
	return count.ok + count.error + count.nonzero;
}
/** @param {number} value @param {number} total */
function rate(value, total) {
	if (!total) return "—";
	const percentage = (100 * value) / total;
	return percentage > 0 && percentage < 0.1
		? "<0.1%"
		: `${percentage.toFixed(1)}%`;
}
/** @param {string} value */
function date(value) {
	return value ? value.replace("T", " ").replace(/\.\d+Z$/, "Z") : "—";
}
/** @param {string[]} headers @param {Array<Array<string | HTMLElement>>} rows @param {string} empty */
function table(headers, rows, empty) {
	if (!rows.length) return node("p", empty);
	const t = document.createElement("table");
	const head = t.createTHead().insertRow();
	for (const label of headers) {
		const cell = document.createElement("th");
		cell.scope = "col";
		cell.textContent = label;
		head.append(cell);
	}
	const body = t.createTBody();
	for (const values of rows) {
		const row = body.insertRow();
		for (const value of values) {
			const cell = row.insertCell();
			if (typeof value === "string") cell.textContent = value;
			else cell.append(value);
		}
	}
	return t;
}
/** @param {string} label @param {() => void} action */
function button(label, action) {
	const b = document.createElement("button");
	b.type = "button";
	b.textContent = label;
	b.addEventListener("click", action);
	return b;
}
const primaryHeaders = ["Calls", "Share", "Errors"];
/** @param {Counts} c @param {number} total */
function primaryCells(c, total) {
	return [number(c.calls), rate(c.calls, total), number(c.error)];
}
/** @param {Record<string, string>} selection @param {import('../src/contracts.ts').Outcome | "all"} [result] */
function selectCalls(selection, result = "all") {
	for (const [key, value] of Object.entries(selection)) {
		const control = field(key);
		if (
			control instanceof HTMLSelectElement &&
			!Array.from(control.options).some((o) => o.value === value)
		)
			control.add(new Option(value, value));
		control.value = value;
	}
	outcome.value = result;
	applyFilters();
	element("calls-heading").focus();
	element("calls-heading").scrollIntoView({ block: "start" });
}
/** @param {import('../src/contracts.ts').OutcomeGroup[]} groups @param {"error" | "nonzero"} result */
function patternTable(groups, result) {
	return table(
		["Tool", "Model", "Message", "Count", "Last seen"],
		groups.map((g) => [
			g.tool,
			`${g.provider} / ${g.model}`,
			button(g.signature || "(empty message)", () =>
				selectCalls(
					{
						tool: g.tool,
						provider: g.provider,
						model: g.model,
						signature: g.signature,
					},
					result,
				),
			),
			number(g.count),
			date(g.lastSeen),
		]),
		result === "error" ? "No errors." : "No nonzero exits.",
	);
}
/** @param {string} id @param {Node[]} content */
function replaceOverview(id, ...content) {
	const target = element(id);
	if (!target.contains(document.activeElement))
		target.replaceChildren(...content);
}
function renderActivity() {
	if (!activityDays) return;
	const plot = element("activity-plot");
	plot.replaceChildren(
		activityChart(
			activityDays,
			activityMetric.value === "error" ? "error" : "calls",
			plot.clientWidth,
		),
	);
}
/** @param {import('../src/contracts.ts').Overview} overview */
function renderOverview(overview) {
	latestOverview = overview;
	const c = overview.totals;
	element("totals").replaceChildren(
		node("strong", `${number(c.calls)} calls`),
		node("span", `${number(c.error)} errors`),
	);
	const modelItems = overview.byModel.map((row) => ({
		...row,
		label: `${row.provider} / ${row.model}`,
		select: () =>
			selectCalls({ provider: row.provider, model: row.model, signature: "" }),
	}));
	const toolItems = overview.byTool.map((row) => ({
		...row,
		label: row.tool,
		select: () => selectCalls({ tool: row.tool, signature: "" }),
	}));
	replaceOverview("tool-chart", usageChart(toolItems.slice(0, 10), c.calls));
	replaceOverview("model-chart", usageChart(modelItems.slice(0, 6), c.calls));
	const modelRows = modelItems.map((row) => [
		button(row.label, row.select),
		...primaryCells(row, c.calls),
	]);
	const toolRows = toolItems.map((row) => [
		button(row.label, row.select),
		...primaryCells(row, c.calls),
	]);
	replaceOverview(
		"models",
		table(["Model", ...primaryHeaders], modelRows, "No calls."),
	);
	replaceOverview(
		"tools",
		table(["Tool", ...primaryHeaders], toolRows, "No calls."),
	);
	activityDays = dailySeries(overview.daily);
	renderActivity();
	replaceOverview(
		"daily",
		table(
			["Day (UTC)", "Calls", "Errors", "Error rate"],
			activityDays.map((c) => [
				button(c.day, () =>
					selectCalls(
						{ since: c.day, until: c.day },
						activityMetric.value === "error" ? "error" : "all",
					),
				),
				number(c.calls),
				number(c.error),
				rate(c.error, completed(c)),
			]),
			"No calls.",
		),
	);
	replaceOverview("groups", patternTable(overview.groups, "error"));
	element("errors-summary").textContent = `Errors · ${number(c.error)}`;
	replaceOverview("exits", patternTable(overview.exits, "nonzero"));
	element("exits-summary").textContent = c.nonzero
		? `Nonzero exits · ${number(c.nonzero)}`
		: "Nonzero exits";
	const gaps = [];
	for (const [key, label] of /** @type {const} */ ([
		["incomplete", "No final result"],
		["unknown", "Unclassified result"],
	])) {
		if (c[key])
			gaps.push(
				button(`${label}: ${number(c[key])}`, () => {
					outcome.value = key;
					cursor = null;
					void refreshCalls();
					element("calls-heading").focus();
					element("calls-heading").scrollIntoView({ block: "start" });
				}),
			);
	}
	replaceOverview(
		"outcome-coverage",
		...(gaps.length
			? gaps
			: [node("p", "No missing or unclassified results.")]),
	);
}
/** @param {HTMLSelectElement} select @param {string[]} values */
function options(select, values) {
	const current = select.value;
	const existing = Array.from(select.options)
		.slice(1)
		.map((o) => o.value);
	const desired = [...new Set(values)].sort();
	if (current && !desired.includes(current)) desired.push(current);
	if (existing.join("\0") === desired.join("\0")) return;
	const first = select.options[0];
	if (!first) throw new Error("Missing default filter option");
	select.replaceChildren(
		first,
		...desired.map((value) => new Option(value, value)),
	);
	select.value = current;
}
/** @param {import('../src/contracts.ts').Facets} facets */
function renderFacets(facets) {
	options(
		/** @type {HTMLSelectElement} */ (field("provider")),
		facets.models.map((m) => m.provider),
	);
	options(
		/** @type {HTMLSelectElement} */ (field("model")),
		facets.models.map((m) => m.model),
	);
	options(/** @type {HTMLSelectElement} */ (field("tool")), facets.tools);
	options(/** @type {HTMLSelectElement} */ (field("project")), facets.projects);
}
async function refreshSessions() {
	clearTimeout(sessionSearchTimer);
	sessionsRequest?.abort();
	const request = (sessionsRequest = new AbortController());
	const params = new URLSearchParams({ q: sessionSearch.value.trim() });
	try {
		/** @type {import('../src/contracts.ts').SessionPage} */
		const page = await api(`/api/sessions?${params}`, request.signal);
		if (request.signal.aborted) return;
		// A native picker may be open while indexing updates arrive.
		if (document.activeElement === sessionSelect) return;
		const current = sessionSelect.value;
		const retained = Array.from(sessionSelect.options).filter(
			(option) =>
				option.value &&
				(option.value === current || option.value === initialSession),
		);
		const choices = new Map(
			retained.map((option) => [
				option.value,
				option.textContent || option.value,
			]),
		);
		for (const session of page.sessions) {
			choices.set(
				session.id,
				`${session.id === initialSession ? "Current session · " : ""}${session.project || "(no project)"} · ${date(session.updatedAt)} · ${session.id.slice(0, 8)}`,
			);
		}
		const desired = [
			new Option("All sessions", "", !initialSession),
			...Array.from(
				choices,
				([id, label]) => new Option(label, id, id === initialSession),
			),
		];
		const existing = Array.from(sessionSelect.options);
		if (
			existing.length !== desired.length ||
			desired.some(
				(option, index) =>
					option.value !== existing[index]?.value ||
					option.textContent !== existing[index]?.textContent,
			)
		) {
			sessionSelect.replaceChildren(...desired);
			sessionSelect.value = current;
		}
		element("sessions-status").textContent =
			`${page.sessions.length} ${params.get("q") ? "matching" : "recent"} sessions${page.hasMore ? " · Search for more" : ""}`;
	} catch (error) {
		if (!request.signal.aborted) {
			element("sessions-status").textContent =
				"Session choices could not be loaded. Edit the search or refresh to retry; your selected scope is unchanged.";
			report(error);
		}
	}
}
async function refreshData() {
	void refreshSessions();
	dataRequest?.abort();
	const request = (dataRequest = new AbortController());
	const requestedRevision = revision;
	try {
		const usageQuery = new URLSearchParams();
		for (const key of ["session", "project", "since", "until"]) {
			const value = query.get(key);
			if (value) usageQuery.set(key, value);
		}
		const [overview, facets, usage] = await Promise.all([
			api(`/api/overview?${query}`, request.signal),
			api("/api/facets", request.signal),
			api(`/api/usage?${usageQuery}`, request.signal),
		]);
		if (request.signal.aborted) return;
		renderOverview(overview);
		renderFacets(facets);
		renderUsage(usage);
		loadedRevision = requestedRevision;
	} catch (error) {
		report(error);
	}
}
async function refreshCalls() {
	callsRequest?.abort();
	const request = (callsRequest = new AbortController());
	const params = new URLSearchParams(query);
	params.set("outcome", outcome.value);
	params.set("limit", "50");
	if (cursor !== null) params.set("cursor", String(cursor));
	element("calls-status").textContent = "Loading calls…";
	older.disabled = true;
	try {
		/** @type {import('../src/contracts.ts').CallPage} */
		const page = await api(`/api/calls?${params}`, request.signal);
		if (request.signal.aborted) return;
		nextCursor = page.nextCursor;
		callButtons = new Map();
		const rows = page.rows.map((call) => {
			const action = button(date(call.timestamp), () => openDetail(call.id));
			callButtons.set(call.id, action);
			return [
				action,
				outcomeLabel(call.outcome) +
					(call.exitCode === null ? "" : ` (${call.exitCode})`),
				call.tool,
				call.signature,
				`${call.provider} / ${call.model}`,
				call.scope,
				call.project,
				call.preview,
			];
		});
		element("calls").replaceChildren(
			table(
				[
					"Time (UTC)",
					"Outcome",
					"Tool",
					"Signature",
					"Model",
					"Scope",
					"Project",
					"Preview",
				],
				rows,
				"No matching calls.",
			),
		);
		element("calls-status").textContent =
			`${number(page.rows.length)} calls${cursor === null ? " · newest first" : " · older page"}`;
		element("new-data").textContent = "";
		older.disabled = nextCursor === null;
		markSelected();
	} catch (error) {
		if (!request.signal.aborted)
			element("calls-status").textContent =
				"Calls could not be loaded. Use Refresh calls to retry.";
		report(error);
	}
}
function markSelected() {
	for (const [id, b] of callButtons) {
		const row = b.closest("tr");
		row?.setAttribute("aria-selected", String(id === selected));
		b.setAttribute("aria-expanded", String(id === selected));
		b.setAttribute("aria-controls", "detail");
	}
}
/** @param {number} id */
async function openDetail(id) {
	detailRequest?.abort();
	const request = (detailRequest = new AbortController());
	selected = id;
	markSelected();
	element("detail").hidden = false;
	element("detail-status").textContent = "Loading persisted call…";
	element("detail-content").replaceChildren();
	element("detail-heading").focus();
	element("detail").scrollIntoView({ block: "start" });
	try {
		/** @type {import('../src/contracts.ts').CallDetail} */
		const detail = await api(`/api/calls/${id}`, request.signal);
		if (request.signal.aborted) return;
		element("detail-status").textContent =
			`${detail.call.tool} · ${outcomeLabel(detail.call.outcome)} · ${date(detail.call.timestamp)}`;
		const content = element("detail-content");
		const metadata = document.createElement("dl");
		for (const [key, value] of Object.entries({
			Provider: detail.call.provider,
			Model: detail.call.model,
			Project: detail.call.project,
			Scope: detail.call.scope,
			Source: `${detail.path}:${detail.line}`,
			Session: detail.sessionId,
			"Call ID": detail.callId,
			"Parent call": detail.parentCallId || "—",
		}))
			metadata.append(node("dt", key), node("dd", value));
		content.append(metadata);
		const notes = document.createElement("ul");
		for (const text of detail.notes) notes.append(node("li", text));
		if (detail.notes.length) content.append(notes);
		content.append(
			node("h3", "Arguments"),
			node("pre", detail.arguments),
			node("h3", "Result"),
			node("pre", detail.result),
			node("h3", "Context"),
		);
		if (!detail.context.length)
			content.append(node("p", "No neighbouring messages are available."));
		for (const message of detail.context) {
			const item = document.createElement("details");
			item.append(
				node(
					"summary",
					`${message.role} · line ${message.line} · ${date(message.timestamp)}`,
				),
				node("pre", message.text),
			);
			content.append(item);
		}
	} catch (error) {
		if (!request.signal.aborted)
			element("detail-status").textContent =
				"Detail could not be loaded. Select the call again to retry.";
		report(error);
	}
}
/** @param {import('../src/contracts.ts').Outcome} value */
function outcomeLabel(value) {
	return {
		ok: "OK",
		error: "Error",
		nonzero: "Nonzero exit",
		incomplete: "No final result",
		unknown: "Unclassified result",
	}[value];
}
function applyFilters() {
	query = new URLSearchParams();
	for (const [key, value] of new FormData(form)) {
		if (typeof value !== "string") continue;
		const filtered = key === "signature" ? value : value.trim();
		if (filtered) query.set(key, filtered);
	}
	element("pattern").hidden = !query.has("signature");
	element("pattern-text").textContent = query.has("signature")
		? `${query.get("tool") || "All tools"} · ${query.get("model") || "All models"} · ${query.get("signature")}`
		: "";
	const url = new URL(location.href);
	if (query.has("session"))
		url.searchParams.set("session", query.get("session") || "");
	else url.searchParams.delete("session");
	history.replaceState(null, "", url.pathname + url.search + url.hash);
	cursor = null;
	detailRequest?.abort();
	selected = null;
	element("detail").hidden = true;
	element("error").hidden = true;
	void refreshData();
	void refreshCalls();
}
form.addEventListener("submit", (event) => {
	event.preventDefault();
	applyFilters();
});
form.addEventListener("reset", () => {
	sessionSearch.value = "";
	field("signature").value = "";
	outcome.value = "all";
	activityMetric.value = "calls";
	setTimeout(applyFilters, 0);
});
element("clear-pattern").addEventListener("click", () => {
	field("signature").value = "";
	applyFilters();
});
sessionSelect.addEventListener("change", applyFilters);
sessionSelect.addEventListener("blur", () => void refreshSessions());
element("all-sessions").addEventListener("click", () => {
	sessionSelect.value = "";
	applyFilters();
});
element("current-session").addEventListener("click", () => {
	sessionSelect.value = initialSession;
	applyFilters();
});
sessionSearch.addEventListener("input", () => {
	clearTimeout(sessionSearchTimer);
	sessionsRequest?.abort();
	sessionSearchTimer = setTimeout(refreshSessions, 200);
});
outcome.addEventListener("change", () => {
	cursor = null;
	void refreshCalls();
});
older.addEventListener("click", () => {
	if (nextCursor !== null) {
		cursor = nextCursor;
		void refreshCalls();
	}
});
element("newest").addEventListener("click", () => {
	cursor = null;
	void refreshCalls();
});
element("refresh").addEventListener("click", () => {
	cursor = null;
	void refreshCalls();
});
element("close-detail").addEventListener("click", () => {
	detailRequest?.abort();
	element("detail").hidden = true;
	if (selected !== null)
		(callButtons.get(selected) || element("calls-heading")).focus();
	selected = null;
	markSelected();
});
/** @param {import('../src/contracts.ts').IndexStatus} status */
function renderStatus(status) {
	const label = `${status.phase} · ${number(status.files)} files · ${number(status.entries)} entries${status.lastScan ? ` · scanned ${date(status.lastScan)}` : ""}`;
	if (element("status").textContent !== label)
		element("status").textContent = label;
	const c = status.coverage;
	const gaps = [
		[c.wrappersWithoutTraces, "wrappers without traces"],
		[c.droppedTraces, "dropped traces"],
		[c.malformedLines, "malformed lines"],
		[c.unpairedResults, "unpaired results"],
		[c.nativeIncomplete, "incomplete native-call records"],
		[c.uncorrelatedNativeOmitted, "uncorrelated native calls omitted"],
		[c.unreadableCachedResults, "unreadable cached results"],
	]
		.filter(([count]) => Number(count) > 0)
		.map(([count, label]) => `${number(Number(count))} ${label}`);
	const coverage = gaps.length
		? `Whole index: ${gaps.join(" · ")}`
		: "Whole index: no coverage gaps reported.";
	if (element("coverage-text").textContent !== coverage)
		element("coverage-text").textContent = coverage;
	const messages = [
		...(status.error ? [status.error] : []),
		...status.issues.map((i) => `${i.path}: ${i.message}`),
	];
	const list = element("index-issues");
	if (list.textContent !== messages.join(""))
		list.replaceChildren(...messages.map((m) => node("li", m)));
	if (messages.length)
		/** @type {HTMLDetailsElement} */ (element("coverage")).open = true;
}
let stopped = false;
activityMetric.addEventListener("change", renderActivity);
element("overview").addEventListener("focusout", (event) => {
	if (
		event.relatedTarget instanceof Node &&
		element("overview").contains(event.relatedTarget)
	)
		return;
	queueMicrotask(() => {
		if (latestOverview && !element("overview").contains(document.activeElement))
			renderOverview(latestOverview);
	});
});
let activityWidth = 0;
const chartResize = new ResizeObserver(([entry]) => {
	const width = Math.floor(entry?.contentRect.width ?? 0);
	if (width === activityWidth) return;
	activityWidth = width;
	renderActivity();
});
chartResize.observe(element("activity-plot"));
async function poll() {
	try {
		/** @type {import('../src/contracts.ts').IndexStatus} */
		const status = await api("/api/status");
		renderStatus(status);
		const first = revision < 0;
		const changed = revision !== status.revision;
		revision = status.revision;
		if (first) {
			applyFilters();
		} else if (changed || loadedRevision !== revision) {
			void refreshData();
			element("new-data").textContent = "New calls available";
		}
	} catch (error) {
		report(error);
		element("status").textContent = "Local index unavailable · retrying";
	}
	if (!stopped) setTimeout(poll, 2000);
}
window.addEventListener("pagehide", () => {
	chartResize.disconnect();
	stopped = true;
	dataRequest?.abort();
	callsRequest?.abort();
	detailRequest?.abort();
	sessionsRequest?.abort();
	clearTimeout(sessionSearchTimer);
});
void poll();
