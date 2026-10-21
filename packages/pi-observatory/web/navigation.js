// @ts-check
import { element } from "./view-dom.js";

/** @typedef {{view: string, filters: string, outcome: string, scroll: number, call: number | null, cursors: Array<number | null>}} ViewState */
/** @typedef {{observatory: true, current: ViewState, origin: ViewState | null}} NavigationState */

/**
 * @param {{
 * getQuery: () => URLSearchParams,
 * restoreFilters: (filters: string) => void,
 * applyFilters: (push?: boolean, scroll?: number) => Promise<unknown>,
 * calls: ReturnType<typeof import('./calls-view.js').createCallsView>,
 * overview: ReturnType<typeof import('./overview-view.js').createOverviewView>,
 * customTabs: ReturnType<typeof import('./custom-tabs-view.js').createCustomTabsView>,
 * onViewChange: () => void
 * }} options
 */
export function createNavigation({
	getQuery,
	restoreFilters,
	applyFilters,
	calls,
	overview,
	customTabs,
	onViewChange,
}) {
	const outcome = /** @type {HTMLSelectElement} */ (element("outcome"));
	let activeView = "overview";
	let navigationVersion = 0;
	history.scrollRestoration = "manual";
	/** @type {ViewState | null} */ let drillOrigin = null;

	function viewState() {
		return {
			view: activeView,
			filters: getQuery().toString(),
			outcome: outcome.value,
			scroll: window.scrollY,
			call: activeView === "detail" ? calls.snapshot().call : null,
			cursors: calls.snapshot().cursors,
		};
	}
	/** @param {boolean} [push] @param {number} [scroll] */
	function saveNavigation(push = false, scroll = window.scrollY) {
		/** @type {NavigationState} */
		const state = {
			observatory: true,
			current: viewState(),
			origin: drillOrigin,
		};
		state.current.scroll = scroll;
		const url = new URL(location.href);
		if (getQuery().has("session"))
			url.searchParams.set("session", getQuery().get("session") || "");
		else url.searchParams.delete("session");
		if (push)
			history.pushState(state, "", url.pathname + url.search + url.hash);
		else history.replaceState(state, "", url.pathname + url.search + url.hash);
	}
	/** @param {string} id */
	async function navigate(id) {
		if (id === activeView) return;
		saveNavigation();
		if (drillOrigin && id !== "calls-panel") {
			const scroll = id === drillOrigin.view ? drillOrigin.scroll : 0;
			restoreFilters(drillOrigin.filters);
			outcome.value = drillOrigin.outcome;
			drillOrigin = null;
			showView(id);
			const version = navigationVersion;
			await applyFilters(true, scroll);
			if (version === navigationVersion) window.scrollTo(0, scroll);
			return;
		}
		showView(id);
		saveNavigation(true, 0);
		onViewChange();
		window.scrollTo(0, 0);
	}
	/** @param {string} id */
	function showView(id) {
		if (id.startsWith("custom:") && !customTabs.has(id.slice(7)))
			id = "overview";
		navigationVersion++;
		if (id !== "detail") {
			calls.closeDetail();
		}
		activeView = id;
		for (const button of document.querySelectorAll("button[data-view]")) {
			const active =
				button.getAttribute("data-view") ===
				(id === "detail" ? "calls-panel" : id);
			button.setAttribute("aria-pressed", String(active));
		}
		for (const panel of [
			"overview",
			"capability-usage",
			"calls-panel",
			"detail",
		])
			element(panel).hidden = panel !== id;
		customTabs.show(id.startsWith("custom:") ? id.slice(7) : null);
		element("back-to-view").hidden = !drillOrigin;
		if (id === "overview") overview.renderActivity();
	}
	element("view-nav").addEventListener("click", (event) => {
		const button =
			event.target instanceof Element
				? event.target.closest("button[data-view]")
				: null;
		if (button) void navigate(button.getAttribute("data-view") || "overview");
	});
	element("back-to-view").addEventListener("click", () => history.back());
	/** @param {NavigationState} state */
	async function restoreNavigation(state) {
		drillOrigin = state.origin;
		restoreFilters(state.current.filters);
		outcome.value = state.current.outcome;
		const target = state.current;
		showView(target.view === "detail" ? "calls-panel" : target.view);
		const version = navigationVersion;
		await applyFilters(false, target.scroll);
		if (version !== navigationVersion) return;
		if (target.cursors.length > 1) {
			await calls.restorePage(target.cursors);
			if (version !== navigationVersion) return;
		}
		if (target.view === "detail" && target.call !== null) {
			await openDetail(target.call, false, target.scroll);
		} else {
			saveNavigation(false, target.scroll);
			window.scrollTo(0, target.scroll);
		}
	}
	window.addEventListener("popstate", (event) => {
		/** @type {NavigationState | null} */
		const state = event.state;
		if (!state?.observatory) return;
		void restoreNavigation(state);
	});
	// Browser Back does not pass through navigate: keep the departing entry current.
	window.addEventListener(
		"scroll",
		() => {
			/** @type {NavigationState | null} */
			const state = history.state;
			if (state?.observatory && state.current.view === activeView)
				history.replaceState(
					{ ...state, current: { ...state.current, scroll: window.scrollY } },
					"",
				);
		},
		{ passive: true },
	);
	function savePage() {
		/** @type {NavigationState | null} */
		const state = history.state;
		if (state?.observatory)
			history.replaceState(
				{
					...state,
					current: { ...state.current, cursors: calls.snapshot().cursors },
				},
				"",
			);
	}

	/** @param {Record<string, string>} selection @param {import('../src/contracts.ts').Outcome | "all"} [result] */
	function selectCalls(selection, result = "all") {
		saveNavigation();
		drillOrigin = viewState();
		// Use applied filters, not unfinished editor changes.
		const filters = new URLSearchParams(drillOrigin.filters);
		for (const [key, value] of Object.entries(selection))
			filters.set(key, value);
		restoreFilters(filters.toString());
		outcome.value = result;
		showView("calls-panel");
		void applyFilters(true, 0);
		element("calls-heading").focus({ preventScroll: true });
		window.scrollTo(0, 0);
	}

	/** @param {string} day */
	function selectUsageDay(day) {
		saveNavigation();
		const filters = new URLSearchParams(getQuery());
		filters.set("since", day);
		filters.set("until", day);
		restoreFilters(filters.toString());
		void applyFilters(true, 0);
		element("capability-heading").focus({ preventScroll: true });
		window.scrollTo(0, 0);
	}

	/** @param {number} id @param {boolean} [push] @param {number} [scroll] */
	async function openDetail(id, push = true, scroll = 0) {
		if (push) saveNavigation();
		showView("detail");
		const version = navigationVersion;
		const loaded = calls.openDetail(id);
		saveNavigation(push, scroll);
		window.scrollTo(0, 0);
		await loaded;
		if (version === navigationVersion && scroll) window.scrollTo(0, scroll);
	}
	element("close-detail").addEventListener("click", () => history.back());
	return {
		save: saveNavigation,
		savePage,
		restore: restoreNavigation,
		selectCalls,
		selectUsageDay,
		openDetail,
		show: showView,
		getView: () => activeView,
	};
}
