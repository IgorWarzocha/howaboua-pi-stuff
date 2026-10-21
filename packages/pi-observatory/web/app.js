// @ts-check
import { api, report } from "./api.js";
import { createCallsView } from "./calls-view.js";
import { createCustomTabsView } from "./custom-tabs-view.js";
import { createFiltersView } from "./filters-view.js";
import { createMonitorControl } from "./monitor-view.js";
import { createNavigation } from "./navigation.js";
import { createOverviewView } from "./overview-view.js";
import { createUsageView } from "./usage-view.js";
import { element } from "./view-dom.js";

let query = new URLSearchParams();
let revision = -1;
/** @type {Map<string, number>} */ const loadedRevisions = new Map();
let facetsRevision = -1;
let callsLoaded = false;
let lastBusy = false;
let stopped = false;
/** @type {AbortController | undefined} */ let dataRequest;
const usageView = createUsageView((day) => navigation.selectUsageDay(day));
const customTabs = createCustomTabsView(() => query);
const monitor = createMonitorControl();
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
	customTabs,
	onViewChange: () => {
		void refreshData();
	},
});

async function refreshData() {
	if (revision < 0) return;
	dataRequest?.abort();
	const request = (dataRequest = new AbortController());
	const requestedRevision = revision;
	const view = navigation.getView();
	try {
		const jobs = [];
		if (facetsRevision !== revision) {
			void filters.refreshSessions();
			jobs.push(
				api("/api/facets", request.signal).then((facets) => {
					if (request.signal.aborted) return;
					filters.renderFacets(facets);
					facetsRevision = requestedRevision;
				}),
			);
		}
		if (loadedRevisions.get(view) !== revision) {
			if (view === "overview")
				jobs.push(
					api(`/api/overview?${query}`, request.signal).then((data) => {
						if (!request.signal.aborted) overviewView.render(data);
					}),
				);
			if (view === "capability-usage") {
				const usageQuery = new URLSearchParams();
				for (const key of ["session", "project", "since", "until"]) {
					const value = query.get(key);
					if (value) usageQuery.set(key, value);
				}
				jobs.push(
					api(`/api/usage?${usageQuery}`, request.signal).then((data) => {
						if (!request.signal.aborted)
							usageView.render(data, usageQuery.toString());
					}),
				);
			}
		}
		if (view === "calls-panel" && !callsLoaded) {
			jobs.push(
				calls.refresh().then(() => {
					if (!request.signal.aborted) callsLoaded = true;
				}),
			);
		}
		await Promise.all(jobs);
		if (request.signal.aborted) return;
		loadedRevisions.set(view, requestedRevision);
	} catch (error) {
		report(error);
	}
}

/** @param {boolean} [push] @param {number} [scroll] */
function applyFilters(push = false, scroll = window.scrollY) {
	if (navigation.getView() === "detail") navigation.show("calls-panel");
	query = filters.read();
	loadedRevisions.clear();
	callsLoaded = false;
	customTabs.context();
	calls.resetPage();
	navigation.save(push, scroll);
	calls.closeDetail();
	element("error").hidden = true;
	return refreshData();
}
element("outcome").addEventListener("change", () => {
	navigation.save();
	void calls.refresh();
});
async function poll() {
	void customTabs.refresh();
	try {
		const state = await monitor.refresh();
		const first = revision < 0;
		const changed = revision !== state.revision;
		if (first || changed || lastBusy !== state.busy) {
			/** @type {import('../src/contracts.ts').IndexStatus} */
			const status = await api("/api/status");
			overviewView.renderStatus(status);
		}
		lastBusy = state.busy;
		revision = state.revision;
		if (first) {
			/** @type {import("./navigation.js").NavigationState | null} */
			const saved = history.state;
			if (saved?.observatory) void navigation.restore(saved);
			else void applyFilters();
		} else if (
			changed ||
			loadedRevisions.get(navigation.getView()) !== revision
		) {
			void refreshData();
			element("new-data").hidden = false;
		}
	} catch (error) {
		report(error);
	}
	if (!stopped) setTimeout(poll, 2000);
}

window.addEventListener("pagehide", () => {
	stopped = true;
	dataRequest?.abort();
	overviewView.dispose();
	usageView.dispose();
	calls.dispose();
	filters.dispose();
	customTabs.dispose();
	monitor.dispose();
});
void customTabs.load().then(() => {
	if (!stopped) void poll();
});
