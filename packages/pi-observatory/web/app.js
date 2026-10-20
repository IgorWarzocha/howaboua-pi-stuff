// @ts-check
import { api, report } from "./api.js";
import { createCallsView } from "./calls-view.js";
import { createFiltersView } from "./filters-view.js";
import { createNavigation } from "./navigation.js";
import { createOverviewView } from "./overview-view.js";
import { createUsageView } from "./usage-view.js";
import { element } from "./view-dom.js";

let query = new URLSearchParams();
let revision = -1;
let loadedRevision = -1;
let stopped = false;
/** @type {AbortController | undefined} */ let dataRequest;
const renderUsage = createUsageView();
const filters = createFiltersView(() => {
	void applyFilters();
});
const calls = createCallsView(
	() => query,
	(id) => {
		void navigation.openDetail(id);
	},
	() => navigation.savePage(),
);
const overviewView = createOverviewView(
	(selection, result) => navigation.selectCalls(selection, result),
	() => query,
);
const navigation = createNavigation({
	getQuery: () => query,
	restoreFilters: filters.restore,
	applyFilters,
	calls,
	overview: overviewView,
});

async function refreshData() {
	void filters.refreshSessions();
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
		overviewView.render(overview);
		filters.renderFacets(facets);
		renderUsage(usage, usageQuery.toString());
		loadedRevision = requestedRevision;
	} catch (error) {
		report(error);
	}
}

/** @param {boolean} [push] @param {number} [scroll] */
function applyFilters(push = false, scroll = window.scrollY) {
	if (navigation.getView() === "detail") navigation.show("calls-panel");
	query = filters.read();
	calls.resetPage();
	navigation.save(push, scroll);
	calls.closeDetail();
	element("error").hidden = true;
	return Promise.all([refreshData(), calls.refresh()]);
}
element("outcome").addEventListener("change", () => {
	navigation.save();
	void calls.refresh();
});
element("refresh").addEventListener("click", () => {
	element("error").hidden = true;
	void refreshData();
	void calls.refresh();
});
async function poll() {
	try {
		/** @type {import('../src/contracts.ts').IndexStatus} */
		const status = await api("/api/status");
		overviewView.renderStatus(status);
		const first = revision < 0;
		const changed = revision !== status.revision;
		revision = status.revision;
		if (first) {
			/** @type {import("./navigation.js").NavigationState | null} */
			const saved = history.state;
			if (saved?.observatory) void navigation.restore(saved);
			else void applyFilters();
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
	stopped = true;
	dataRequest?.abort();
	overviewView.dispose();
	calls.dispose();
	filters.dispose();
});
void poll();
